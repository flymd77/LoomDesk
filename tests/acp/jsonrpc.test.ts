import { describe, expect, it } from 'vitest'
import {
  decodeMessage,
  encodeMessage,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  JsonRpcErrorCode,
  type JsonRpcMessage
} from '../../src/main/acp/jsonrpc'

describe('decodeMessage', () => {
  it('decodes a request frame', () => {
    const msg = decodeMessage('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
    expect(isJsonRpcRequest(msg)).toBe(true)
    if (isJsonRpcRequest(msg)) {
      expect(msg.id).toBe(1)
      expect(msg.method).toBe('initialize')
    }
  })

  it('decodes a notification frame (no id)', () => {
    const msg = decodeMessage('{"jsonrpc":"2.0","method":"session/update","params":{"x":1}}')
    expect(isJsonRpcNotification(msg)).toBe(true)
    expect(isJsonRpcRequest(msg)).toBe(false)
  })

  it('decodes a success response', () => {
    const msg = decodeMessage('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}')
    expect(isJsonRpcSuccessResponse(msg)).toBe(true)
    expect(isJsonRpcErrorResponse(msg)).toBe(false)
  })

  it('decodes an error response and exposes the code', () => {
    const msg = decodeMessage(
      '{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"Method not found"}}'
    )
    expect(isJsonRpcErrorResponse(msg)).toBe(true)
    if (isJsonRpcErrorResponse(msg)) {
      expect(msg.error.code).toBe(JsonRpcErrorCode.MethodNotFound)
      expect(msg.id).toBe(7)
    }
  })

  it('accepts string ids', () => {
    const msg = decodeMessage('{"jsonrpc":"2.0","id":"abc","result":null}')
    expect(isJsonRpcSuccessResponse(msg)).toBe(true)
    if (isJsonRpcSuccessResponse(msg)) {
      expect(msg.id).toBe('abc')
    }
  })

  it('rejects malformed JSON', () => {
    expect(() => decodeMessage('{not json')).toThrow()
  })

  it('rejects empty frames', () => {
    expect(() => decodeMessage('   ')).toThrow('empty frame')
  })

  it('rejects non-object frames', () => {
    expect(() => decodeMessage('[1,2,3]')).toThrow('not an object')
  })

  it('rejects unsupported jsonrpc versions', () => {
    expect(() => decodeMessage('{"jsonrpc":"1.0","id":1,"result":null}')).toThrow(
      /unsupported jsonrpc version/
    )
  })
})

describe('encodeMessage', () => {
  it('appends a newline terminator', () => {
    const frame = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(frame.endsWith('\n')).toBe(true)
    expect(frame).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n')
  })

  it('round-trips through decodeMessage', () => {
    const original: JsonRpcMessage = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { kind: 'agent_message' } }
    }
    const decoded = decodeMessage(encodeMessage(original))
    expect(isJsonRpcNotification(decoded)).toBe(true)
    if (isJsonRpcNotification(decoded)) {
      expect(decoded.method).toBe('session/update')
    }
  })
})
