import { hostname } from "node:os"
import {
  ROOT_CONTEXT,
  trace,
  type Attributes,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api"
import { ExportResultCode, type ExportResult } from "@opentelemetry/core"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  AggregationType,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
  type ViewOptions,
} from "@opentelemetry/sdk-metrics"
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base"
import type { PluginConfig } from "./config.js"
import type { LifecycleLogger } from "./lifecycle.js"

export interface TelemetryRuntime {
  tracer: Tracer
  contextFor(span: Span): Context
  recordWorkflow(durationMs: number, attributes: Attributes): void
  recordOperation(durationMs: number, attributes: Attributes): void
  recordTokenUsage(value: number, attributes: Attributes): void
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

function histogramView(instrumentName: string, boundaries: number[]): ViewOptions {
  return {
    instrumentName,
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries, recordMinMax: true },
    },
  }
}

function countMetricSeries(metrics: ResourceMetrics): number {
  return metrics.scopeMetrics.reduce(
    (total, scopeMetric) => total + scopeMetric.metrics.length,
    0,
  )
}

function createTraceExporter(
  config: PluginConfig,
  log?: LifecycleLogger,
): SpanExporter {
  const exporter = new OTLPTraceExporter({
    url: config.traceUrl,
    headers: config.headers,
    timeoutMillis: config.exportTimeoutMs,
  })
  return {
    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      exporter.export(spans, (result) => {
        if (result.code === ExportResultCode.SUCCESS) {
          void log?.("info", "uploaded spans", {
            spans: spans.length,
            trace_url: config.traceUrl,
          })
        } else {
          void log?.("warn", "failed", {
            phase: "upload spans",
            error: result.error?.message ?? "unknown export error",
            trace_url: config.traceUrl,
          })
        }
        resultCallback(result)
      })
    },
    forceFlush(): Promise<void> {
      return exporter.forceFlush()
    },
    shutdown(): Promise<void> {
      return exporter.shutdown()
    },
  }
}

function createMetricExporter(
  config: PluginConfig,
  log?: LifecycleLogger,
): PushMetricExporter {
  const exporter = new OTLPMetricExporter({
    url: config.metricsUrl,
    headers: config.headers,
    timeoutMillis: config.exportTimeoutMs,
    temporalityPreference: 0,
  })
  return {
    export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
      exporter.export(metrics, (result) => {
        if (result.code === ExportResultCode.SUCCESS) {
          void log?.("info", "uploaded metrics", {
            metrics: countMetricSeries(metrics),
            metrics_url: config.metricsUrl,
          })
        } else {
          void log?.("warn", "failed", {
            phase: "upload metrics",
            error: result.error?.message ?? "unknown export error",
            metrics_url: config.metricsUrl,
          })
        }
        resultCallback(result)
      })
    },
    forceFlush(): Promise<void> {
      return exporter.forceFlush()
    },
    selectAggregationTemporality(instrumentType) {
      return exporter.selectAggregationTemporality(instrumentType)
    },
    selectAggregation(instrumentType) {
      return exporter.selectAggregation?.(instrumentType)
    },
    shutdown(): Promise<void> {
      return exporter.shutdown()
    },
  }
}

export function createTelemetry(config: PluginConfig, log?: LifecycleLogger): TelemetryRuntime {
  const exporter = createTraceExporter(config, log)
  const processor = new BatchSpanProcessor(exporter, {
    scheduledDelayMillis: config.batchDelayMs,
    exportTimeoutMillis: config.exportTimeoutMs,
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
  })
  const resource = resourceFromAttributes({
    "service.name": config.serviceName,
    "telemetry.sdk.language": "nodejs",
    "telemetry.sdk.name": "gtrace",
    "telemetry.sdk.version": "0.1.0",
    host: hostname(),
    runtime_environment: config.environment,
    agent_id: config.agentId,
    agent_name: config.agentName,
    agent_runtime: "opencode",
    agent_version: config.agentVersion,
    "gen_ai.agent.name": config.agentName,
    "gen_ai.agent.version": config.agentVersion,
    ...config.resourceAttributes,
  })
  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [processor],
    forceFlushTimeoutMillis: config.exportTimeoutMs,
    spanLimits: {
      attributeValueLengthLimit: config.maxAttributeLength,
      attributeCountLimit: 128,
      eventCountLimit: 128,
    },
  })

  let meterProvider: MeterProvider | undefined
  let workflowDuration:
    | ReturnType<ReturnType<MeterProvider["getMeter"]>["createHistogram"]>
    | undefined
  let operationCount:
    | ReturnType<ReturnType<MeterProvider["getMeter"]>["createCounter"]>
    | undefined
  let operationDuration:
    | ReturnType<ReturnType<MeterProvider["getMeter"]>["createHistogram"]>
    | undefined
  let tokenUsage:
    | ReturnType<ReturnType<MeterProvider["getMeter"]>["createHistogram"]>
    | undefined

  if (config.metricsEnabled) {
    const metricExporter = createMetricExporter(config, log)
    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: Math.max(60000, config.exportTimeoutMs + 1000),
      exportTimeoutMillis: config.exportTimeoutMs,
    })
    meterProvider = new MeterProvider({
      resource,
      readers: [reader],
      views: [
        histogramView("gen_ai.workflow.duration", [
          1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200,
        ]),
        histogramView("gen_ai.agent.operation.duration", [
          10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480, 40960, 81920,
        ]),
        histogramView("gen_ai.client.token.usage", [
          1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
          16777216, 67108864,
        ]),
      ],
    })
    const meter = meterProvider.getMeter("opencode-otel-plugin", config.agentVersion)
    workflowDuration = meter.createHistogram("gen_ai.workflow.duration", {
      unit: "s",
      description: "GenAI workflow duration.",
    })
    operationCount = meter.createCounter("gen_ai.agent.operation.count", {
      description: "Agent-side operation count.",
    })
    operationDuration = meter.createHistogram("gen_ai.agent.operation.duration", {
      unit: "ms",
      description: "Agent-side operation duration.",
    })
    tokenUsage = meter.createHistogram("gen_ai.client.token.usage", {
      unit: "{token}",
      description: "Number of input and output tokens used.",
    })
  }

  return {
    tracer: provider.getTracer("opencode-otel-plugin", config.agentVersion),
    contextFor(span) {
      return trace.setSpan(ROOT_CONTEXT, span)
    },
    recordWorkflow(durationMs, metricAttributes) {
      if (durationMs > 0) workflowDuration?.record(durationMs / 1000, metricAttributes)
    },
    recordOperation(durationMs, metricAttributes) {
      operationCount?.add(1, metricAttributes)
      if (durationMs > 0) operationDuration?.record(durationMs, metricAttributes)
    },
    recordTokenUsage(value, metricAttributes) {
      if (value > 0) tokenUsage?.record(value, metricAttributes)
    },
    async forceFlush() {
      try {
        await Promise.all([provider.forceFlush(), meterProvider?.forceFlush()])
      } catch (error) {
        await log?.("warn", "failed", {
          phase: "forceFlush",
          error:
            error instanceof Error ? error.message : typeof error === "string" ? error : "unknown",
        })
        throw error
      }
    },
    async shutdown() {
      try {
        await Promise.all([provider.shutdown(), meterProvider?.shutdown()])
      } catch (error) {
        await log?.("warn", "failed", {
          phase: "shutdown",
          error:
            error instanceof Error ? error.message : typeof error === "string" ? error : "unknown",
        })
        throw error
      }
    },
  }
}
