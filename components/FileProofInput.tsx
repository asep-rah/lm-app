'use client';

import { useEffect, useId, useState } from 'react';
import { Camera, Upload } from 'lucide-react';

export default function FileProofInput({
  file,
  onFile,
  accept = 'image/*',
  capture,
  required,
  label = 'Pilih File / Foto Bukti',
  icon = 'camera',
  disabled
}: {
  file?: File | null;
  onFile: (file: File | null) => void;
  accept?: string;
  capture?: boolean | 'user' | 'environment';
  required?: boolean;
  label?: string;
  icon?: 'camera' | 'upload';
  disabled?: boolean;
}) {
  const id = useId();
  const [preview, setPreview] = useState('');
  const [videoPreview, setVideoPreview] = useState('');

  useEffect(() => {
    const type = String(file?.type || '');
    if (!file || (!type.startsWith('image/') && !type.startsWith('video/'))) {
      setPreview('');
      setVideoPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    if (type.startsWith('video/')) {
      setVideoPreview(url);
      setPreview('');
    } else {
      setPreview(url);
      setVideoPreview('');
    }
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const Glyph = icon === 'upload' ? Upload : Camera;
  const captureAttr = capture === true ? 'environment' : capture || undefined;

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className={`cursor-pointer flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-slate-700 font-medium text-sm transition-all ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <Glyph className="w-4 h-4 shrink-0" strokeWidth={2.2} />
        {file ? file.name : label}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        capture={captureAttr}
        required={required}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />
      {preview && (
        <img
          src={preview}
          alt="Pratinjau"
          className="h-20 w-full object-cover rounded-lg border border-slate-200"
        />
      )}
      {videoPreview && (
        <video src={videoPreview} controls className="h-28 w-full rounded-lg border border-slate-200 bg-black" />
      )}
      {file && !preview && !videoPreview && (
        <p className="text-[10px] text-slate-500 font-medium truncate">{file.name}</p>
      )}
    </div>
  );
}
