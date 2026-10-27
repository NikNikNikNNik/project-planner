import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { trainingNoteForDisplay } from './training-note-display.ts';

test('hides source document titles while preserving planning details and caveats', () => {
  const note = 'ПРЕДВАРИТЕЛЬНО. Источники: Сводный план обучения от 27.10.2017. Абсолютная дата не определена источником; требуется подтверждение.';
  assert.equal(trainingNoteForDisplay(note), 'ПРЕДВАРИТЕЛЬНО. Абсолютная дата не определена источником; требуется подтверждение.');
  assert.ok(note.includes('Сводный план обучения'), 'Stored note must remain unchanged');
});

test('hides source lists and links without consuming subsequent notes', () => {
  assert.equal(trainingNoteForDisplay('Источники: Матрица обучения; План 2018.\nАудитория: операторы.\nИсточник: https://example.kz/price; прайс от 12.08.2026. Цена предварительная.'),
    'Аудитория: операторы.\nЦена предварительная.');
});

test('handles source-only notes, missing punctuation, CRLF, and empty notes', () => {
  for (const note of [null, undefined, '', 'Источник: План.xlsx', 'ИСТОЧНИКИ: План.']) {
    assert.equal(trainingNoteForDisplay(note), '');
  }
  assert.equal(trainingNoteForDisplay('Источник: План.xlsx\r\nУсловия: очно.'), 'Условия: очно.');
  assert.equal(trainingNoteForDisplay('Условия: очно. Длительность требует уточнения.'), 'Условия: очно. Длительность требует уточнения.');
});

test('all training information popovers filter notes, not the editable note field', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.equal((app.match(/trainingNoteForDisplay\((?:item\.)?event\.note\)/g) ?? []).length, 6);
  assert.doesNotMatch(app, /\{(?:item\.)?event\.note\}<\/p>/);
  assert.match(app, /value=\{note\} onChange=\{e => setNote\(e\.target\.value\)\}/);
});

test('hides the historical ten-year shift without changing stored dates or other caveats', () => {
  const note = 'ПРЕДВАРИТЕЛЬНО. Источники: План 2018. Календарные даты сдвинуты на +10 лет: 2028-01-01, 2028-10-01. Если источник указал только месяц, день 01 — условный. Аудитория: операторы.';
  assert.equal(trainingNoteForDisplay(note),
    'ПРЕДВАРИТЕЛЬНО. Если источник указал только месяц, день 01 — условный. Аудитория: операторы.');
  assert.ok(note.includes('Календарные даты сдвинуты на +10 лет: 2028-01-01'));
  assert.equal(trainingNoteForDisplay('Календарные даты сдвинуты на +10 лет: 2028-01-01.'), '');
  assert.equal(trainingNoteForDisplay('Календарные даты сдвинуты на 10 лет: 2028-01-01\r\nСтоимость предварительная.'), 'Стоимость предварительная.');
  assert.equal(trainingNoteForDisplay('Обучение: 10 лет опыта. Начало: 2028-01-01.'), 'Обучение: 10 лет опыта. Начало: 2028-01-01.');
});
