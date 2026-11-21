import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SYSTEM, makeContext } from './helpers.js';
import { createSmtpClient } from '../src/services/mail/smtp.js';
import { issueOtp, verifyOtp } from '../src/services/emailOtp.js';

describe('SMTP transport error classification', () => {
  // A fake transport that throws the given error, so no socket is opened.
  const clientThatThrows = (err) =>
    createSmtpClient({ host: 'h', user: 'u', pass: 'p', from: 'f@x.test', transport: { sendMail: async () => { throw err; }, close() {} } });

  const kindOf = async (err) => {
    try {
      await clientThatThrows(err).sendMail({ to: 'a@b.test', subject: 's', html: '<p>x</p>' });
      return 'no-error';
    } catch (e) {
      return e.kind;
    }
  };

  it('maps auth failures to systemic (pauses sending)', async () => {
    assert.equal(await kindOf({ code: 'EAUTH' }), 'systemic');
    assert.equal(await kindOf({ responseCode: 535 }), 'systemic');
  });

  it('maps connection/4xx problems to transient (retry)', async () => {
    assert.equal(await kindOf({ code: 'ETIMEDOUT' }), 'transient');
    assert.equal(await kindOf({ code: 'ECONNECTION' }), 'transient');
    assert.equal(await kindOf({ responseCode: 421 }), 'transient');
    assert.equal(await kindOf({ responseCode: 451 }), 'transient');
  });

  it('maps rejected recipients / 5xx to permanent (give up on this message)', async () => {
    assert.equal(await kindOf({ responseCode: 550 }), 'permanent');
    assert.equal(await kindOf({ code: 'EENVELOPE', responseCode: 553 }), 'permanent');
  });

  it('refuses to build without full configuration', () => {
    assert.throws(() => createSmtpClient({ host: 'h', user: '', pass: 'p', from: 'f' }), /not fully configured/);
  });
});

describe('email OTP service', () => {
  let ctx;
  before(async () => { ctx = await makeContext(); });
  after(() => ctx.close());
  const run = (fn) => ctx.db.withContext(SYSTEM, fn);

  it('verifies the right code once, then never again', async () => {
    const issued = await run((q) => issueOtp(q, { purpose: 'register', email: 'a@otp.test' }));
    assert.match(issued.code, /^\d{6}$/);
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'a@otp.test', code: issued.code })), true);
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'a@otp.test', code: issued.code })), false, 'a code is single-use');
  });

  it('rejects a wrong code and burns the code after max attempts', async () => {
    const issued = await run((q) => issueOtp(q, { purpose: 'register', email: 'b@otp.test' }));
    for (let i = 0; i < 5; i++) {
      assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'b@otp.test', code: '000000' })), false);
    }
    // The real code no longer works: too many wrong attempts consumed it.
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'b@otp.test', code: issued.code })), false);
  });

  it('does not reissue within the resend cooldown', async () => {
    await run((q) => issueOtp(q, { purpose: 'password_reset', email: 'c@otp.test' }));
    const second = await run((q) => issueOtp(q, { purpose: 'password_reset', email: 'c@otp.test' }));
    assert.ok(second.cooldownSeconds > 0, 'a second request within the cooldown returns a wait, not a new code');
    assert.equal(second.code, undefined);
  });

  it('rejects an expired code', async () => {
    const issued = await run((q) => issueOtp(q, { purpose: 'register', email: 'd@otp.test' }));
    await run((q) => q.query(`UPDATE email_otps SET expires_at = now() - interval '1 minute' WHERE email = 'd@otp.test'`));
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'd@otp.test', code: issued.code })), false);
  });

  it('with consume:false checks the code without using it up', async () => {
    const issued = await run((q) => issueOtp(q, { purpose: 'register', email: 'f@otp.test' }));
    // A non-consuming check passes repeatedly (the Verify-email button) ...
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'f@otp.test', code: issued.code, consume: false })), true);
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'f@otp.test', code: issued.code, consume: false })), true);
    // ... and the code still works once for the final consuming verify (submit).
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'f@otp.test', code: issued.code })), true);
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'register', email: 'f@otp.test', code: issued.code })), false);
  });

  it('keeps purposes separate', async () => {
    const reg = await run((q) => issueOtp(q, { purpose: 'register', email: 'e@otp.test' }));
    // A register code must not verify a password_reset for the same address.
    assert.equal(await run((q) => verifyOtp(q, { purpose: 'password_reset', email: 'e@otp.test', code: reg.code })), false);
  });
});
