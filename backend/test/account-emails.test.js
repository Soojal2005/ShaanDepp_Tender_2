import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RESET_PATH, resetLink } from '../src/services/accountEmails.js';

// These links are what a customer clicks in a "reset password" / "set your password"
// (invite) email. The bug was a wrong base domain (procure-brain.com / localhost);
// the path itself must stay '/reset-password' to match the SPA route in src/App.jsx.
describe('password-reset / invite link', () => {
  it('builds the live link on the correct domain and path', () => {
    assert.equal(
      resetLink('https://www.procure-brain.in', 'abc123'),
      'https://www.procure-brain.in/reset-password?token=abc123'
    );
  });

  it('is slash-safe when the base URL has a trailing slash', () => {
    assert.equal(
      resetLink('https://www.procure-brain.in/', 'abc123'),
      'https://www.procure-brain.in/reset-password?token=abc123'
    );
  });

  it('url-encodes the token so it survives in the query string', () => {
    assert.equal(
      resetLink('https://www.procure-brain.in', 'a b/+='),
      'https://www.procure-brain.in/reset-password?token=a%20b%2F%2B%3D'
    );
  });

  it('uses the /reset-password route the frontend actually serves', () => {
    assert.equal(RESET_PATH, '/reset-password');
  });
});
