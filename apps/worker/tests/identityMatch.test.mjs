import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  domainRoot, emailDomain, normalizeCompanyToken, corroboratesIdentity, FREE_EMAIL_DOMAINS,
} from '../src/utils/identityMatch.mjs';

test('domainRoot extracts the second-level label', () => {
  assert.equal(domainRoot('enginy.ai'), 'enginy');
  assert.equal(domainRoot('www.Enginy.AI'), 'enginy');
  assert.equal(domainRoot('mail.acme.co.uk'), 'acme');
  assert.equal(domainRoot('acme.com'), 'acme');
  assert.equal(domainRoot(''), null);
  assert.equal(domainRoot(null), null);
});

test('emailDomain pulls the lowercased domain', () => {
  assert.equal(emailDomain('Sebastian.Boeck@Enginy.AI'), 'enginy.ai');
  assert.equal(emailDomain('no-at-sign'), null);
});

test('normalizeCompanyToken collapses to a comparable token', () => {
  assert.equal(normalizeCompanyToken('ENGINY'), 'enginy');
  assert.equal(normalizeCompanyToken('Black Forest Labs 🌲'), 'blackforest');
  assert.equal(normalizeCompanyToken('Acme, Inc.'), 'acme');
  assert.equal(normalizeCompanyToken('Foo Technologies'), 'foo');
});

test('Boeck case: name + enginy.ai corroborates against company ENGINY', () => {
  const boeck = { domain: null, company: 'ENGINY', emailDomains: ['outlook.com'] };
  assert.equal(corroboratesIdentity(boeck, 'enginy.ai'), true);
});

test('Schröder case: enginy.ai does NOT corroborate against Black Forest Labs', () => {
  const schroeder = { domain: null, company: 'Black Forest Labs 🌲', emailDomains: [] };
  assert.equal(corroboratesIdentity(schroeder, 'enginy.ai'), false);
});

test('free/personal email domains never corroborate', () => {
  const c = { domain: 'enginy.ai', company: 'ENGINY', emailDomains: ['enginy.ai'] };
  for (const d of ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'gmx.de']) {
    assert.equal(corroboratesIdentity(c, d), false, `${d} should not corroborate`);
  }
  assert.ok(FREE_EMAIL_DOMAINS.has('gmail.com'));
});

test('stored company domain corroborates', () => {
  const c = { domain: 'acme.com', company: null, emailDomains: [] };
  assert.equal(corroboratesIdentity(c, 'acme.com'), true);
  assert.equal(corroboratesIdentity(c, 'other.com'), false);
});

test('another known email at the same domain corroborates', () => {
  const c = { domain: null, company: null, emailDomains: ['jane@nope'.split('@')[1], 'acme.com'] };
  assert.equal(corroboratesIdentity(c, 'acme.com'), true);
});

test('short company tokens do not over-match via prefix', () => {
  // company "Co" → token "" after suffix strip → no corroboration on a random domain
  const c = { domain: null, company: 'Co', emailDomains: [] };
  assert.equal(corroboratesIdentity(c, 'enginy.ai'), false);
});

test('missing incoming domain is safe', () => {
  assert.equal(corroboratesIdentity({ company: 'ENGINY' }, null), false);
  assert.equal(corroboratesIdentity({ company: 'ENGINY' }, ''), false);
});
