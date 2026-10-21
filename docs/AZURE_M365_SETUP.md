# Sending email through your Microsoft 365 mailbox

All subscriber email (daily alerts, weekly-report notices, reminders, password links) leaves from **your own mailbox**, through the Microsoft Graph `sendMail` call. Each message also appears in that mailbox's Sent Items, so you can see exactly what subscribers received.

Until this is set up the system runs in **dry-run mode**: every email is written as an HTML file under the outbox folder and recorded as `dry_run`. It is never reported as sent.

You need a Microsoft 365 administrator (Global Administrator or Application Administrator, plus Exchange Administrator for step 4). Allow about 30 minutes.

## 1. Choose the sending mailbox

Use a dedicated mailbox such as `alerts@procure-brain.com`. A **shared mailbox** is enough and needs no licence; it must exist before step 4. Replies go to this mailbox, so decide who reads it.

## 2. Register the application (Microsoft Entra admin centre)

1. Entra admin centre → **Applications → App registrations → New registration**.
2. Name: `procure-brain mailer`. Account type: **this organisational directory only**. No redirect URI. Register.
3. From the Overview page copy **Directory (tenant) ID** and **Application (client) ID**.
4. **Certificates & secrets → New client secret.** Choose the longest validity your policy allows (6 or 12 months is common). **Copy the secret value now**; it is shown once. Note its expiry date in your calendar: when it expires, email stops until a new secret is set.

## 3. Give it permission to send

1. **API permissions → Add a permission → Microsoft Graph → Application permissions.**
2. Add **Mail.Send**.
3. Optional, only if you want bounce tracking (the system reads delivery-failure notices from the mailbox so it stops mailing dead addresses): add **Mail.ReadWrite**.
4. Click **Grant admin consent for your organisation** and confirm the status shows "Granted".

## 4. Restrict the app to that one mailbox (important)

By default an application with `Mail.Send` can send as **any** mailbox in the organisation. Limit it to the alerts mailbox. In Exchange Online PowerShell:

```powershell
Connect-ExchangeOnline

# a mail-enabled security group that contains only the sending mailbox
New-DistributionGroup -Name "procure-brain-senders" -Type Security -Members "alerts@procure-brain.com"

New-ApplicationAccessPolicy `
  -AppId <Application (client) ID> `
  -PolicyScopeGroupId procure-brain-senders@procure-brain.com `
  -AccessRight RestrictAccess `
  -Description "procure-brain may use only the alerts mailbox"

# should report: AccessCheckResult : Granted
Test-ApplicationAccessPolicy -Identity alerts@procure-brain.com -AppId <Application (client) ID>
# should report: AccessCheckResult : Denied
Test-ApplicationAccessPolicy -Identity someone.else@procure-brain.com -AppId <Application (client) ID>
```

Policy changes can take up to an hour to take effect. Microsoft is moving this control to "RBAC for Applications" in Exchange Online; if your tenant already uses it, create the equivalent role assignment scoped to the one mailbox. Check Microsoft's current guidance when you do this step.

## 5. Tell the system

Put these in the server's `.env` (see `deploy/production.env.example`):

```
AZURE_TENANT_ID=<Directory (tenant) ID>
AZURE_CLIENT_ID=<Application (client) ID>
AZURE_CLIENT_SECRET=<secret value>
GRAPH_SENDER_MAILBOX=alerts@procure-brain.com
OPS_ALERT_EMAIL=<the person who should hear about failures>
MAIL_MODE=live
```

Restart the application. With `MAIL_MODE=live` and any of the four Azure values missing, the application refuses to start, so a half-configured system cannot run.

## 6. Check it

1. Sign in as a platform administrator → **Administration → Mail Queue**. The mode should read **Live**.
2. Open **Alert Profiles**, choose **Send me a test**. The message should arrive within a minute and appear in the mailbox's Sent Items.
3. If it does not: the Mail Queue page shows the failure reason. `401`/`403` means the permission, consent or access policy is wrong (the sender pauses for 15 minutes and emails the ops address); `404` usually means the mailbox name is wrong.

## Limits the system respects

| Limit | Value | Setting |
|---|---|---|
| Messages per minute | 25 (Exchange Online allows 30 per mailbox) | `GRAPH_RATE_LIMIT_PER_MIN` |
| Recipients per day | 10,000 (Exchange Online limit per mailbox) | `GRAPH_DAILY_LIMIT` |
| Throttled by Microsoft (HTTP 429) | waits for the `Retry-After` time, then resumes | automatic |

Messages beyond a window simply wait in the queue and go out in the next one; nothing is dropped.

## Renewing the secret

Create a new secret in the same app registration, put it in `.env`, restart, then delete the old secret. Do this before the expiry date.
