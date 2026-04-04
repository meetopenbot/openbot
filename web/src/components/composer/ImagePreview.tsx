import { cn } from "../../lib/utils";

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

interface ImagePreviewProps {
  pendingImages: PendingImage[];
  onRemove: (id: string) => void;
}

export function ImagePreview({ pendingImages, onRemove }: ImagePreviewProps) {
  if (pendingImages.length === 0) return null;

  return (
    <div className="px-3 pt-3">
      <div className="flex flex-wrap gap-2">
        {pendingImages.map((image) => (
          <div key={image.id} className="relative group animate-in fade-in scale-in-95">
            <img
              src={image.previewUrl}
              alt={image.file.name}
              className="h-16 w-16 rounded-lg border border-border/60 object-cover shadow-sm transition-all duration-200 hover:border-border"
            />
            <button
              type="button"
              onClick={() => onRemove(image.id)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-sm transition-all duration-200 hover:text-foreground"
              aria-label={`Remove ${image.file.name}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
