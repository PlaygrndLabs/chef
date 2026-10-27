import { useEffect, useRef, useState, type Ref } from "react";
import { ArrowUp, AudioLines, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { withImages } from "@/lib/uploads";

interface Attached {
  readonly key: string;
  readonly preview: string;
  readonly path: string | null;
}

export function Composer({
  placeholder,
  hint,
  onSend,
  draft,
  ref,
  id,
  onLive,
  onUpload,
}: {
  readonly placeholder: string;
  readonly hint?: string;
  readonly onSend: (text: string) => Promise<boolean> | boolean;
  readonly draft?: { readonly text: string; readonly n: number } | null;
  readonly ref?: Ref<HTMLTextAreaElement>;
  readonly id?: string;
  readonly onLive?: () => void;
  readonly onUpload?: (file: File) => Promise<string>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [images, setImages] = useState<readonly Attached[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = images.some((image) => image.path === null);
  const attach = (files: Iterable<File>) => {
    if (!onUpload) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const key = `${Date.now()}-${Math.random()}`;
      const preview = URL.createObjectURL(file);
      setImages((list) => [...list, { key, preview, path: null }]);
      onUpload(file).then(
        (path) => setImages((list) => list.map((image) => (image.key === key ? { ...image, path } : image))),
        (error: unknown) => {
          setImages((list) => list.filter((image) => image.key !== key));
          URL.revokeObjectURL(preview);
          toast.error("Could not attach the image", { description: error instanceof Error ? error.message : String(error) });
        },
      );
    }
  };
  const remove = (key: string) =>
    setImages((list) => {
      const gone = list.find((image) => image.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((image) => image.key !== key);
    });
  useEffect(() => {
    if (draft) setText(draft.text);
  }, [draft]);
  const submit = async () => {
    const paths = images.flatMap((image) => (image.path ? [image.path] : []));
    const value = withImages(text.trim(), paths);
    if (!value || sending || uploading) return;
    setSending(true);
    try {
      if (await onSend(value)) {
        setText("");
        for (const image of images) URL.revokeObjectURL(image.preview);
        setImages([]);
      }
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="px-4 pt-2 pb-4 sm:px-6 sm:pb-5" id={id}>
      <div
        className="mx-auto max-w-3xl rounded-2xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring/30"
        onDragOver={(e) => {
          if (onUpload && [...e.dataTransfer.items].some((item) => item.type.startsWith("image/"))) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!onUpload || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          attach(e.dataTransfer.files);
        }}
      >
        {images.length ? (
          <ul className="flex flex-wrap gap-2 px-4 pt-3" data-attached>
            {images.map((image) => (
              <li key={image.key} className="relative size-14 overflow-hidden rounded-lg border" data-attached-image={image.path ?? "uploading"}>
                <img src={image.preview} alt="Attached image" className="size-full object-cover" />
                {image.path === null ? <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-white drop-shadow" /> : null}
                <button type="button" onClick={() => remove(image.key)} aria-label="Remove image" className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white">
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (!onUpload || e.clipboardData.files.length === 0) return;
            e.preventDefault();
            attach(e.clipboardData.files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="block max-h-48 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{hint}</span>
          {onUpload ? (
            <>
              <input
                ref={picker}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) attach(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => picker.current?.click()} aria-label="Attach an image" title="Attach a screenshot or mockup to design from">
                <ImagePlus />
              </Button>
            </>
          ) : null}
          {onLive ? (
            <Button size="icon" variant="ghost" className="rounded-xl" onClick={onLive} aria-label="Talk live" title="Talk live with Chef" id="talk-button">
              <AudioLines />
            </Button>
          ) : null}
          <Button size="icon" className="rounded-xl" onClick={() => void submit()} disabled={(!text.trim() && !images.length) || sending || uploading} aria-label="Send">
            {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </div>
  );
}
