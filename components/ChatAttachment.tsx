'use client';

import { stripInvoiceTag } from '@/lib/chatInvoice';

const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic|bmp)(\?|$)/i;
const URL_RE = /https?:\/\/[^\s]+/i;
const DATA_IMAGE_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/;

export function attachmentFromMessage(m: any): { url: string; type: string } | null {
  const url = String(m?.image_url || m?.attachment_url || '').trim();
  const type = String(m?.attachment_type || '').toLowerCase();
  if (url) {
    const isImg = type.includes('image') || url.startsWith('data:image') || IMAGE_RE.test(url);
    return { url, type: isImg ? 'image' : type || 'file' };
  }
  const text = stripInvoiceTag(String(m?.message || ''));
  const data = text.match(DATA_IMAGE_RE);
  if (data) return { url: data[0], type: 'image' };
  const found = text.match(URL_RE);
  if (!found) return null;
  const href = found[0];
  return { url: href, type: IMAGE_RE.test(href) || type.includes('image') ? 'image' : 'file' };
}

export function visibleChatText(m: any) {
  const att = attachmentFromMessage(m);
  let text = String(m?.message || '');
  if (att?.url) text = text.replace(att.url, '').trim();
  return stripInvoiceTag(text);
}

export default function ChatAttachment({
  message,
  onOpen
}: {
  message: any;
  onOpen?: (url: string) => void;
}) {
  const att = attachmentFromMessage(message);
  if (!att) return null;
  const isImg = att.type.includes('image') || att.url.startsWith('data:image') || IMAGE_RE.test(att.url);
  if (isImg) {
    return (
      <button
        type="button"
        onClick={() => (onOpen ? onOpen(att.url) : window.open(att.url, '_blank'))}
        className="mt-1.5 block w-full text-left"
      >
        <img src={att.url} alt="Lampiran" className="max-h-40 w-full object-cover rounded-xl border border-white/20" />
      </button>
    );
  }
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold underline"
    >
      📄 Buka file / invoice
    </a>
  );
}
