import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceLineAt, sourceRatioAt } from '../src/reader/sourcePosition.ts'

test('source and rendered positions round-trip within a Markdown block', () => {
  for (const [start, end] of [[0, 1], [3, 20], [100, 1000]]) {
    for (const ratio of [0, .1, .5, .99]) {
      const position = sourceLineAt(start!, end!, ratio)
      assert.ok(position.line >= start! && position.line < end!)
      assert.ok(Math.abs(sourceRatioAt(start!, end!, position) - ratio) < 1e-8)
    }
  }
})
test('source mapping clamps positions outside paragraphs and empty ranges', () => {
  assert.deepEqual(sourceLineAt(5, 5, -1), { line: 5, within: 0 })
  assert.equal(sourceRatioAt(10, 20, { line: 1, within: 0 }), 0)
  assert.equal(sourceRatioAt(10, 20, { line: 30, within: 0 }), 1)
  assert.ok(sourceLineAt(5, 6, 2).line < 6)
})
