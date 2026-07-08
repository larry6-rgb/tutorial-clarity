import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Cadence placeholder — the actual TX Comptroller filing frequency
// (monthly/quarterly/annual) wasn't known when this was built; the welcome
// letter with the web file number was still in the mail. Update the Railway
// Cron Schedule on the TAX-REMINDER service once the real frequency is
// confirmed (see mycpa.cpa.state.tx.us or the letter itself).
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await resend.emails.send({
      from: 'Tutorial Clarity <noreply@tutorialclarity.com>',
      to: ['eppler6@proton.me', 'jason.russell.pmp@gmail.com'],
      subject: 'Reminder: Texas Sales & Use Tax Filing Due',
      html: `
        <p>This is your recurring reminder to file and remit Texas Sales and Use Tax for <strong>Eppler Publishing LLC</strong> (taxpayer #32101730508).</p>
        <p>File via <a href="https://mycpa.cpa.state.tx.us">the Comptroller's eSystems webfile portal</a>. Confirm the exact due date and amount owed before submitting — this email is a nudge, not a substitute for checking your webfile account.</p>
      `,
    });
    return NextResponse.json({ sent: true });
  } catch (err: any) {
    console.error('[cron/tax-reminder]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
