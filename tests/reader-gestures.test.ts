import assert from 'node:assert/strict'
import test from 'node:test'
import { swipeStep, tapZone } from '../src/reader/interaction.ts'
test('horizontal strokes turn one page in the reading direction', () => {
  const stroke = { x: -70, y: 9, elapsed: 300, width: 390, startX: 195 }
  assert.equal(swipeStep(stroke), 1)
  assert.equal(swipeStep({ ...stroke, x: 70 }), -1)
  assert.equal(swipeStep({ ...stroke, x: -200 }), 1)
})
test('scrolling, small motions, long holds and system edge gestures never turn pages', () => {
  const stroke = { x: -70, y: 0, elapsed: 300, width: 390, startX: 195 }
  for (const change of [{ x: -20 }, { y: 100 }, { elapsed: 1200 }, { startX: 10 }, { startX: 380 }]) assert.equal(swipeStep({ ...stroke, ...change }), 0)
})
test('center is reserved for controls and diagonal corner zones keep their direction', () => {
  assert.equal(tapZone(.5, .5), 'center')
  assert.equal(tapZone(.1, .8), -1)
  assert.equal(tapZone(.9, .2), 1)
  assert.equal(tapZone(.48, .9), -1)
  assert.equal(tapZone(.52, .1), 1)
})
