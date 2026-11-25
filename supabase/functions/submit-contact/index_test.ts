// Deno unit tests for submit-contact's pure functions: validation, newline stripping
// (subject-injection guard), and HTML escaping in the email body. No network, no deploy,
// no real emails -- `handle` itself (which touches Supabase/Resend) is not exercised here.
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildEmailHtml, buildSubject, stripNewlines, validateContact } from './index.ts';

const base = { kind: 'call', name: 'Jane Smith', email: 'jane@example.com', company: '', phone: '', message: '' };

Deno.test('validateContact: accepts a minimal valid call request', () => {
  const result = validateContact(base);
  assert(result !== null);
  assertEquals(result?.kind, 'call');
  assertEquals(result?.name, 'Jane Smith');
});

Deno.test('validateContact: accepts feedback with a message', () => {
  const result = validateContact({ ...base, kind: 'feedback', message: 'Loved the demo.' });
  assert(result !== null);
  assertEquals(result?.message, 'Loved the demo.');
});

Deno.test('validateContact: rejects feedback with no message', () => {
  assertEquals(validateContact({ ...base, kind: 'feedback', message: '' }), null);
});

Deno.test('validateContact: rejects an unknown kind', () => {
  assertEquals(validateContact({ ...base, kind: 'sales' }), null);
});

Deno.test('validateContact: rejects empty or missing name', () => {
  assertEquals(validateContact({ ...base, name: '' }), null);
  assertEquals(validateContact({ ...base, name: undefined }), null);
});

Deno.test('validateContact: rejects a name over 100 chars', () => {
  assertEquals(validateContact({ ...base, name: 'a'.repeat(101) }), null);
});

Deno.test('validateContact: accepts a name at exactly 100 chars', () => {
  assert(validateContact({ ...base, name: 'a'.repeat(100) }) !== null);
});

Deno.test('validateContact: rejects a malformed email', () => {
  assertEquals(validateContact({ ...base, email: 'not-an-email' }), null);
  assertEquals(validateContact({ ...base, email: '' }), null);
});

Deno.test('validateContact: rejects an email over 200 chars', () => {
  const longEmail = 'a'.repeat(195) + '@b.com'; // > 200 chars
  assertEquals(validateContact({ ...base, email: longEmail }), null);
});

Deno.test('validateContact: rejects company/phone/message over their limits', () => {
  assertEquals(validateContact({ ...base, company: 'a'.repeat(151) }), null);
  assertEquals(validateContact({ ...base, phone: '1'.repeat(41) }), null);
  assertEquals(validateContact({ ...base, message: 'a'.repeat(2001) }), null);
});

Deno.test('validateContact: rejects a non-object body', () => {
  assertEquals(validateContact(null), null);
  assertEquals(validateContact('hello'), null);
  assertEquals(validateContact(42), null);
});

Deno.test('validateContact: trims whitespace on every field', () => {
  const result = validateContact({ ...base, name: '  Jane  ', email: '  jane@example.com  ', company: '  Acme  ' });
  assertEquals(result?.name, 'Jane');
  assertEquals(result?.email, 'jane@example.com');
  assertEquals(result?.company, 'Acme');
});

Deno.test('stripNewlines: collapses CR/LF into spaces', () => {
  assertEquals(stripNewlines('line one\nline two\r\nline three'), 'line one line two line three');
});

Deno.test('stripNewlines: trims the result', () => {
  assertEquals(stripNewlines('  hello  '), 'hello');
});

Deno.test('buildSubject: cannot be used to inject extra header-like lines', () => {
  const payload = validateContact({ ...base, name: 'Evil\nBcc: someone@else.com' })!;
  const subject = buildSubject(payload);
  assert(!subject.includes('\n'));
  assert(!subject.includes('\r'));
});

Deno.test('buildSubject: labels call vs feedback distinctly', () => {
  const callPayload = validateContact(base)!;
  const feedbackPayload = validateContact({ ...base, kind: 'feedback', message: 'hi' })!;
  assertStringIncludes(buildSubject(callPayload), 'call request');
  assertStringIncludes(buildSubject(feedbackPayload), 'feedback');
});

Deno.test('buildEmailHtml: escapes HTML in every user-supplied field', () => {
  const payload = validateContact({
    kind: 'feedback',
    name: '<b>Jane</b>',
    email: 'jane@example.com',
    company: '<img src=x onerror=alert(1)>',
    phone: '555"onmouseover="alert(1)',
    message: '<script>alert(1)</script>',
  })!;
  const html = buildEmailHtml(payload);
  assert(!html.includes('<script>'));
  assert(!html.includes('<img src=x onerror'));
  assert(!html.includes('<b>Jane</b>'));
  assertStringIncludes(html, '&lt;script&gt;');
  assertStringIncludes(html, '&lt;b&gt;Jane&lt;/b&gt;');
});

Deno.test('buildEmailHtml: omits optional fields when blank', () => {
  const payload = validateContact(base)!;
  const html = buildEmailHtml(payload);
  assert(!html.includes('Company'));
  assert(!html.includes('Phone'));
  assertStringIncludes(html, '(no message)');
});

Deno.test('buildEmailHtml: includes optional fields when present', () => {
  const payload = validateContact({ ...base, company: 'Acme Co', phone: '555-1234' })!;
  const html = buildEmailHtml(payload);
  assertStringIncludes(html, 'Acme Co');
  assertStringIncludes(html, '555-1234');
});
