import { useEffect, useState } from "react";

interface ImageFallbackProps {
  src: string | null;
  alt: string;
  fallback: string;
  loading?: "eager" | "lazy";
}

export function ImageFallback({ src, alt, fallback, loading = "lazy" }: ImageFallbackProps) {
  const [didError, setDidError] = useState(false);

  useEffect(() => {
    setDidError(false);
  }, [src]);

  if (!src || didError) {
    return <span>{fallback}</span>;
  }

  return <img src={src} alt={alt} loading={loading} onError={() => setDidError(true)} />;
}
