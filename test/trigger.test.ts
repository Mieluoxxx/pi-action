import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseTrigger } from '../src/trigger';

test('parseTrigger returns not-triggered when phrase is absent', () => {
  const r = parseTrigger('hello world', '@pi');
  assert.equal(r.triggered, false);
  assert.equal(r.prompt, '');
});

test('parseTrigger returns text after phrase', () => {
  const r = parseTrigger('@pi fix the bug', '@pi');
  assert.equal(r.triggered, true);
  assert.equal(r.prompt, 'fix the bug');
});

test('parseTrigger returns empty prompt when phrase is alone', () => {
  const r = parseTrigger('@pi', '@pi');
  assert.equal(r.triggered, true);
  assert.equal(r.prompt, '');
});

test('parseTrigger keeps text after phrase in the middle', () => {
  const r = parseTrigger('hey @pi review this please', '@pi');
  assert.equal(r.triggered, true);
  assert.equal(r.prompt, 'review this please');
});

test('parseTrigger uses first occurrence', () => {
  const r = parseTrigger('@pi a @pi b', '@pi');
  assert.equal(r.prompt, 'a @pi b');
});

test('parseTrigger never treats an empty phrase as a trigger', () => {
  assert.deepEqual(parseTrigger('any comment', ''), { triggered: false, prompt: '' });
});
