/**
 * JSON-RPC 2.0 message primitives for ACP.
 *
 * ACP runs JSON-RPC 2.0 over stdio with newline-delimited frames.
 * This module defines the discriminated message types and small
 * encoding/decoding helpers shared by client and server sides.
 *
 * Spec reference: https://www.jsonrpc.org/specification
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  id: number | string
  result: unknown
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: number | string | null
  error: JsonRpcErrorObject
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse

/** Standard JSON-RPC error codes we may emit or inspect. */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603
} as const

/** Structural guard: is this message a request (has method + id)? */
export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg && 'id' in msg
}

/** Structural guard: is this message a notification (method, no id)? */
export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg)
}

/** Structural guard: is this message an error response? */
export function isJsonRpcErrorResponse(msg: JsonRpcMessage): msg is JsonRpcErrorResponse {
  return 'error' in msg
}

/** Structural guard: is this message a success response? */
export function isJsonRpcSuccessResponse(msg: JsonRpcMessage): msg is JsonRpcSuccessResponse {
  return 'result' in msg && !('method' in msg)
}

/**
 * Parse a single newline-terminated frame into a JSON-RPC message.
 * Throws a plain Error on malformed JSON — the transport layer decides
 * how to surface parse failures (log, reply ParseError, or kill the stream).
 */
export function decodeMessage(line: string): JsonRpcMessage {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    throw new Error('empty frame')
  }
  const parsed: unknown = JSON.parse(trimmed)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('frame is not an object')
  }
  const msg = parsed as JsonRpcMessage
  if (msg.jsonrpc !== '2.0') {
    throw new Error(`unsupported jsonrpc version: ${String(msg.jsonrpc)}`)
  }
  return msg
}

/** Encode a message into a newline-terminated frame ready for stdio. */
export function encodeMessage(msg: JsonRpcMessage): string {
  return `${JSON.stringify(msg)}\n`
}
