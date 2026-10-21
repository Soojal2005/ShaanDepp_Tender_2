# DNS records for procure-brain.com

You need access to wherever the domain's DNS is managed (the registrar or a DNS provider). Make the changes during a quiet hour and keep a copy of the existing records first.

## Website

| Type | Name | Value |
|---|---|---|
| A | `@` | the server's public IPv4 address |
| A | `www` | the same address (the site redirects `www` to the bare domain) |

The server obtains and renews its HTTPS certificate by itself once these resolve. Ports 80 and 443 must be open to the internet.

## Email authentication

Subscribers' mail providers decide whether to trust a message from these three records. Without them, alerts are more likely to land in spam.

### SPF (who may send for the domain)

Add or **merge into the existing** SPF record. There must be exactly one SPF record for the domain.

| Type | Name | Value |
|---|---|---|
| TXT | `@` | `v=spf1 include:spf.protection.outlook.com -all` |

If SPF already lists other senders (a website form service, a marketing tool), keep them and add the `include:` for Microsoft 365 inside the same record.

### DKIM (a signature proving the message was not altered)

1. Microsoft Defender portal → **Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM**.
2. Select `procure-brain.com`. It shows two CNAME records; create them at your DNS provider:

| Type | Name | Value |
|---|---|---|
| CNAME | `selector1._domainkey` | `selector1-procure-brain-com._domainkey.<yourtenant>.onmicrosoft.com` |
| CNAME | `selector2._domainkey` | `selector2-procure-brain-com._domainkey.<yourtenant>.onmicrosoft.com` |

3. Wait for DNS to propagate (often 15 minutes, up to a day), then switch **Sign messages for this domain with DKIM signatures** to **Enabled**.

### DMARC (what receivers should do with failures, and a report to you)

Start in monitoring mode:

| Type | Name | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@procure-brain.com; fo=1` |

Read the reports for two to four weeks. When legitimate mail is passing, tighten the policy to `p=quarantine`, and later `p=reject`.

## Check

- Send a test alert to a Gmail address, open the message → **Show original**. SPF, DKIM and DMARC should each say **PASS**.
- mail-tester.com gives a quick score for a message sent to its address.
- Keep your existing **MX** records unchanged; they control where *incoming* mail goes.
