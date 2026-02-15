'use client';

import { useState, useEffect } from 'react';

interface DigestHeaderProps {
  date: string | Date;
  articleCount: number;
}

export default function DigestHeader({ date, articleCount }: DigestHeaderProps) {
  const [formatted, setFormatted] = useState('');
  const [time, setTime] = useState('');

  useEffect(() => {
    const str = typeof date === 'string' ? date : date.toISOString();
    const utcDate = str.endsWith('Z') ? str : str + 'Z';
    const d = new Date(utcDate);

    setFormatted(d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }));

    setTime(d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }));
  }, [date]);

  if (!formatted) return null;

  return (
    <div className="mb-2">
      <h2 className="text-2xl font-light tracking-tight">{formatted}</h2>
      <p className="text-muted text-sm mt-1">
        {time} &middot; {articleCount} article{articleCount !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
