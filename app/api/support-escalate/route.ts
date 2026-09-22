import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-20) : [];
  const suppliedEmail = typeof body?.email === 'string' ? body.email.trim().slice(0, 254) : '';
  const suppliedPhone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 40) : '';
  if (!messages.length) return NextResponse.json({ error: 'There is no conversation to send.' }, { status: 400 });

  const { userId } = await auth();
  const user = userId ? await currentUser() : null;
  const accountEmail = user?.primaryEmailAddress?.emailAddress || '';
  const replyEmail = suppliedEmail || accountEmail;
  const validEmail = /^\S+@\S+\.\S+$/.test(replyEmail);
  const validPhone = /^[+()\-\s.0-9]{7,40}$/.test(suppliedPhone);
  if (!validEmail && !validPhone) return NextResponse.json({ error: 'Please enter a valid email address or callback number.' }, { status: 400 });

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: 'Email handoff is temporarily unavailable.' }, { status: 503 });
  const transcript = messages.map((m: any) => `<p><strong>${m?.role === 'assistant' ? 'Tutorial Clarity Support' : 'Customer'}:</strong> ${escapeHtml(String(m?.content || '').slice(0, 3000))}</p>`).join('');
  const page = escapeHtml(String(body?.page || 'unknown').slice(0, 300));
  const resend = new Resend(key);
  await resend.emails.send({
    from: process.env.SUPPORT_FROM_EMAIL || 'Tutorial Clarity Support <noreply@tutorialclarity.com>',
    to: process.env.SUPPORT_ESCALATION_EMAIL || 'support@tutorialclarity.com',
    ...(validEmail ? { replyTo: replyEmail } : {}),
    subject: `Tutorial Clarity research follow-up — ${String(body?.topic || 'Customer question').slice(0, 80)}`,
    html: `<h2>Tutorial Clarity research follow-up</h2><p><strong>Email:</strong> ${escapeHtml(validEmail ? replyEmail : 'Not provided')}</p><p><strong>Callback number:</strong> ${escapeHtml(validPhone ? suppliedPhone : 'Not provided')}</p><p><strong>Page:</strong> ${page}</p><hr/>${transcript}`,
  });
  return NextResponse.json({ ok: true });
}
