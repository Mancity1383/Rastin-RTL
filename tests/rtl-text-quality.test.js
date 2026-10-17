import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function runtime() {
  const scope = { window: { RtlFixer: {} }, URL };
  for (const filename of ['constants.js', 'utils.js']) {
    vm.runInNewContext(fs.readFileSync(new URL(`../content/${filename}`, import.meta.url), 'utf8'), scope, { filename });
  }
  return scope.window.RtlFixer;
}

const rtl = runtime();

test('Persian and Arabic numbers, percentages and separators have no strong direction', () => {
  for (const text of ['۱۲۳۴۵۶۷۸۹۰', '١٢٣٤٥٦٧٨٩٠', '۱٬۲۳۴٫۵٪', '،؛؟', '١٢٣، ۴۵۶؛ ۷۸۹؟']) {
    assert.equal(rtl.containsRtl(text), false, text);
    assert.equal(rtl.isRtlDominant(text), false, text);
    assert.equal(rtl.isRtlProse(text), false, text);
    assert.equal(rtl.isRtlTableText(text), false, text);
    assert.equal(rtl.detectParagraphDirection(text), 'ltr', text);
  }
});

test('English metadata remains LTR beside Persian dates, percentages and punctuation', () => {
  for (const text of ['۱۲۳ English status', 'Speed: ۹۹٪', 'Date: ۱۴۰۵/۰۷/۲۰', 'Status، Ready؛ OK؟']) {
    assert.equal(rtl.containsRtl(text), false, text);
    assert.equal(rtl.isRtlProse(text), false, text);
    assert.equal(rtl.isRtlTableText(text), false, text);
    assert.equal(rtl.detectParagraphDirection(text), 'ltr', text);
  }
});

test('Arabic vowel marks and Hebrew niqqud alone cannot trigger RTL', () => {
  for (const text of ['َُِّْ', 'ֱֲֳִֵֶַָּ', '\u0610\u0650\u05B0 Ready']) {
    assert.equal(rtl.containsRtl(text), false, text);
    assert.equal(rtl.isRtlDominant(text), false, text);
    assert.equal(rtl.isRtlProse(text), false, text);
    assert.equal(rtl.isRtlTableText(text), false, text);
    assert.equal(rtl.detectParagraphDirection(text), 'ltr', text);
  }
});

test('Digits, symbols and emoji before Persian or Hebrew do not hide the leading letter', () => {
  for (const text of ['۱۲۳، سلام English words', '✅ → سلام English words', '⟶ ١٢٣ שלום English words', 'ּَِ سلام English words']) {
    assert.equal(rtl.detectParagraphDirection(text), 'rtl', text);
  }
});

test('Greek, Cyrillic and Chinese letters participate in mixed-text dominance', () => {
  for (const text of ['Καλημέρα κόσμε م', 'Привет мир م', '这是一个中文句子 م', '𝓔𝓷𝓰𝓵𝓲𝓼𝓱 م']) {
    assert.equal(rtl.containsRtl(text), true, text);
    assert.equal(rtl.isRtlDominant(text), false, text);
    assert.equal(rtl.isRtlTableText(text), false, text);
    assert.equal(rtl.detectParagraphDirection(text), 'ltr', text);
  }
});

test('Unicode multiplication and division signs are neutral beside a Persian letter', () => {
  for (const text of ['×÷×÷ م', '×÷×÷ א']) {
    assert.equal(rtl.isRtlDominant(text), true, text);
    assert.equal(rtl.detectParagraphDirection(text), 'rtl', text);
  }
});

test('Arabic supplements, presentation forms and Hebrew letters still establish RTL', () => {
  for (const text of ['پژوهش', 'السَّلَام', 'שלום', '\u0750\u0751', '\u0870\u0871', '\uFEFB', '\uFB2A']) {
    assert.equal(rtl.containsRtl(text), true, text);
    assert.equal(rtl.isRtlDominant(text), true, text);
    assert.equal(rtl.detectParagraphDirection(text), 'rtl', text);
  }
});

test('Shared Arabic tatweel and Arabic presentation-form letters cannot become LTR', () => {
  for (const text of ['\u0640', '\u0640\u0640', 'ســلام', '\uFE70', '\uFE72', '\uFDFB', '\uFEFB']) {
    assert.equal(rtl.containsRtl(text), true, text);
    assert.equal(rtl.isRtlDominant(text), true, text);
    assert.equal(rtl.detectParagraphDirection(text), 'rtl', text);
    assert.equal(rtl.STRONG_LTR_CHAR.test(text), false, text);
  }
  assert.equal(rtl.isRtlProse('\u0640\u0640'), true);
  assert.equal(rtl.isRtlTableText('شــرح کامل'), true);
  assert.equal(rtl.detectParagraphDirection('\u0640 Ready'), 'rtl');
  assert.equal(rtl.containsRtl('\u064e'), false, 'A combining vowel mark remains neutral');
});

test('Leading English model names do not reject genuine Persian prose', () => {
  for (const text of ['Transformer-XL توضیح مدل', 'React و Vue مقایسه', 'GPT-4 پاسخ']) {
    assert.equal(rtl.isRtlProse(text), true, text);
  }
  assert.equal(rtl.isRtlProse('Long English sentence with only م'), false);
});

test('Table fallback requires two Arabic words and keeps inline English labels intact', () => {
  assert.equal(rtl.isRtlTableText('Status: فارسی'), false);
  assert.equal(rtl.isRtlTableText('ModelTransformerName توضیح مدل'), true);
  assert.equal(rtl.isRtlTableText('ModelTransformerName می\u200cشود'), false);
  assert.equal(rtl.isRtlTableText('ModelTransformerName می\u200cشود کامل'), true);
  assert.equal(rtl.isRtlTableText('ModelTransformerName عَرَبِی'), false);
  assert.equal(rtl.isRtlTableText('ModelTransformerName عَرَبِی کامل'), true);
});

test('Rapid edits and profile eviction cannot reuse a previous text direction', () => {
  const texts = ['English status ۱۲۳', 'این متن فارسی است', 'Ready، OK؛', 'سلام English words', 'Greek Καλημέρα م'];
  const directions = ['ltr', 'rtl', 'ltr', 'rtl', 'ltr'];
  for (let round = 0; round < 400; round++) {
    for (let index = 0; index < texts.length; index++) {
      const text = `${texts[index]} ${round}`;
      rtl.isRtlDominant(text);
      rtl.isRtlTableText(text);
      assert.equal(rtl.detectParagraphDirection(text), directions[index], text);
    }
  }
  assert.equal(rtl.detectParagraphDirection('English status ۱۲۳ 0'), 'ltr');
  assert.equal(rtl.detectParagraphDirection('این متن فارسی است 0'), 'rtl');
});

test('Very long pasted inputs retain strong-letter and prose rules', () => {
  assert.equal(rtl.detectParagraphDirection(`سلام ${'English '.repeat(2000)}`), 'rtl');
  const ltr = `${'English '.repeat(2000)} م`;
  assert.equal(rtl.isRtlDominant(ltr), false);
  assert.equal(rtl.isRtlTableText(ltr), false);
  assert.equal(rtl.detectParagraphDirection(ltr), 'ltr');
  assert.equal(rtl.isRtlProse('GPT-4 ' + 'پاسخ فارسی '.repeat(2000)), true);
});
