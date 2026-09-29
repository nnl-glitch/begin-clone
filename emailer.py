"""Transactional email sender via Resend.

Silently no-ops when RESEND_API_KEY is empty — callers should check
`is_email_enabled()` to know whether to show a dev-preview link instead.
"""
from __future__ import annotations

import os
import asyncio
import logging

logger = logging.getLogger("scribecraft.emailer")


def is_email_enabled() -> bool:
    return bool((os.environ.get("RESEND_API_KEY") or "").strip())


def _from_addr() -> str:
    return os.environ.get("RESEND_FROM_EMAIL") or "Begin <onboarding@resend.dev>"


async def send_email(to: str, subject: str, html: str, text: str | None = None) -> bool:
    """Send an email via Resend. Returns True on success, False on failure."""
    if not is_email_enabled():
        logger.info(f"[email:disabled] skipped send to {to}")
        return False
    # Lazy import so the module works before `resend` is installed in dev.
    import resend  # type: ignore
    resend.api_key = os.environ["RESEND_API_KEY"]
    params = {
        "from": _from_addr(),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        params["text"] = text
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"[email:sent] {to} id={result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[email:failed] {to}: {e}")
        return False


def render_reset_email(reset_link: str, email: str) -> tuple[str, str]:
    """Return (html, text) for the password-reset email."""
    text = (
        f"Someone (hopefully you) asked to reset the password for {email} on Begin.\n\n"
        f"Open this link within the next hour to set a new one:\n{reset_link}\n\n"
        "If it wasn't you, you can ignore this email — the link expires on its own.\n\n"
        "— Begin"
    )
    html = f"""<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0F1220;font-family:Georgia,'Times New Roman',serif;color:#E8E1D2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0F1220;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141930;border:1px solid #2A2F44;border-radius:14px;">
          <tr>
            <td style="padding:36px 40px 8px 40px;">
              <p style="margin:0;font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#8C8778;">Begin</p>
              <h1 style="margin:12px 0 0 0;font-size:32px;font-weight:400;line-height:1.15;color:#EFE7D6;">Set a new password</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 8px 40px;">
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#D5CEBF;">
                Someone (hopefully you) asked to reset the password for
                <span style="color:#EFE7D6;font-style:italic;">{email}</span>.
              </p>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#D5CEBF;">
                Open the link below within the next hour to set a new one.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 40px 24px 40px;">
              <a href="{reset_link}" style="display:inline-block;padding:14px 28px;background:#EFE7D6;color:#1A1918;text-decoration:none;font-family:Georgia,serif;font-size:16px;border-radius:999px;">
                Reset password
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px 40px;">
              <p style="margin:0 0 8px 0;font-size:12px;color:#8C8778;">Or paste this URL into your browser:</p>
              <p style="margin:0;font-size:12px;color:#B8B0A0;word-break:break-all;">
                <a href="{reset_link}" style="color:#B8B0A0;">{reset_link}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 32px 40px;border-top:1px solid #2A2F44;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#8C8778;font-style:italic;">
                If it wasn't you, you can ignore this — the link will expire on its own.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#5F5B4F;">
          Begin — a writing companion
        </p>
      </td>
    </tr>
  </table>
</body>
</html>"""
    return html, text
