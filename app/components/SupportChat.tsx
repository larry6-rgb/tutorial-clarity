'use client';

import { useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function SupportChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: 'Hello. How can I help with Tutorial Clarity?' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [offerEscalation, setOfferEscalation] = useState(false);
  const [topic, setTopic] = useState('Support question');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const question = text.trim();
    if (!question || busy) return;
    const next = [...messages, { role: 'user' as const, content: question }];
    setMessages(next); setText(''); setBusy(true); setOfferEscalation(false);
    try {
      const res = await fetch('/api/support-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, history: messages.slice(-8), page: window.location.href }) });
      const data = await res.json();
      setMessages([...next, { role: 'assistant', content: data.answer || data.error || 'I could not answer that right now.' }]);
      setOfferEscalation(Boolean(data.offerEscalation || !res.ok));
      if (data.topic) setTopic(data.topic);
    } catch {
      setMessages([...next, { role: 'assistant', content: 'I could not answer that right now. You can send this conversation to human support.' }]);
      setOfferEscalation(true);
    } finally { setBusy(false); }
  }

  async function escalate() {
    setBusy(true);
    const res = await fetch('/api/support-escalate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, email, topic, page: window.location.href }) });
    const data = await res.json();
    if (res.ok) { setSent(true); setOfferEscalation(false); }
    else setMessages([...messages, { role: 'assistant', content: data.error || 'The conversation could not be sent.' }]);
    setBusy(false);
  }

  if (!open) return <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-[100] flex items-center gap-2 rounded-full bg-blue-600 px-5 py-3 font-semibold text-white shadow-xl hover:bg-blue-500" aria-label="Open Tutorial Clarity support"><HelpCircle size={20}/> Help</button>;

  return (
    <section className="fixed bottom-4 right-4 z-[100] flex h-[min(620px,85vh)] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-950 text-white shadow-2xl" aria-label="Tutorial Clarity support chat">
      <header className="flex items-center justify-between bg-blue-700 px-4 py-3"><div><div className="font-bold">Tutorial Clarity Support</div><div className="text-xs text-blue-100">Ask in your own words</div></div><button onClick={() => setOpen(false)} aria-label="Close support"><X/></button></header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.map((m, i) => <div key={i} className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-blue-600' : 'bg-gray-800'}`}>{m.content}</div>)}
        {busy && <div className="text-sm text-gray-400">Working…</div>}
        {offerEscalation && !sent && <div className="rounded-xl border border-amber-700 bg-amber-950 p-3 text-sm"><p className="mb-2">Would you like to send this conversation to human support?</p><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Your reply email" className="mb-2 w-full rounded bg-gray-900 px-3 py-2"/><button onClick={escalate} disabled={busy} className="rounded bg-amber-500 px-3 py-2 font-semibold text-black">Send to support</button><p className="mt-2 text-xs text-amber-200">Never include passwords, verification codes, passkeys, or payment-card information.</p></div>}
        {sent && <div className="rounded-xl border border-green-700 bg-green-950 p-3 text-sm text-green-200">Your conversation has been sent to human support. A reply will be sent to the email you provided.</div>}
      </div>
      <form onSubmit={ask} className="flex gap-2 border-t border-gray-800 p-3"><input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="How do I…?" className="min-w-0 flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"/><button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-blue-600 p-2 disabled:opacity-50" aria-label="Send question"><Send size={20}/></button></form>
    </section>
  );
}
