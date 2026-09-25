import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import type { BootConfig, BootUser } from "../../shared/api";
import { parseTags } from "../../shared/domain";
import { pickFromDrive, preloadDrive } from "../drive";
import { useI18n } from "../i18n";
import { splitTags } from "../tags";
import { fromLocalFiles, type IntakeFile } from "../uploads";
import { DriveIcon, UploadIcon } from "./icons";

function imagesOf(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type === "" || f.type.startsWith("image/"));
}

/**
 * Every way an image enters: drop anywhere on the page, the file dialog, paste, and Drive. All of
 * them become IntakeFiles with the batch tags captured at that moment.
 */
export function Intake({
  boot,
  user,
  onFiles,
}: {
  readonly boot: BootConfig;
  readonly user: BootUser;
  readonly onFiles: (files: readonly IntakeFile[], tags: readonly string[]) => void;
}) {
  const { t, locale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const tagsId = useId();
  const [dragging, setDragging] = useState(false);
  const [tagText, setTagText] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const submit = (files: readonly IntakeFile[]): void => {
    if (files.length === 0) return;
    const tags = splitTags(tagText);
    const parsed = parseTags(tags);
    if (!parsed.ok) {
      setTagError(t.inputIssues[parsed.issue]);
      return;
    }
    setTagError(null);
    onFiles(files, tags);
  };
  // The window listeners below see the current tag box without re-subscribing on every keystroke.
  const submitFromWindow = useEffectEvent(submit);

  useEffect(() => {
    if (boot.drive !== null) void preloadDrive().catch(() => undefined);
  }, [boot.drive]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") === true;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      submitFromWindow(fromLocalFiles(imagesOf(e.dataTransfer?.files)));
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesOf(e.clipboardData?.files);
      if (files.length === 0) return;
      e.preventDefault();
      // Pasted screenshots are all called "image.png"; a timestamp keeps them apart in the library.
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/gu, "").replace("T", "-");
      submitFromWindow(
        fromLocalFiles(files).map((f, i) => (f.name === "image.png" ? { ...f, name: `pasted-${stamp}${i > 0 ? `-${String(i + 1)}` : ""}.png` } : f)),
      );
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  const fromDrive = (): void => {
    if (boot.drive === null) return;
    setPicking(true);
    pickFromDrive(boot.drive, { loginHint: user.email, locale, accept: boot.upload.accept })
      .then((files) => {
        submit(files);
      })
      .catch(() => {
        setTagError(t.errors.drive_download);
      })
      .finally(() => {
        setPicking(false);
      });
  };

  const maxMb = Math.round(boot.upload.maxBytes / (1024 * 1024));

  return (
    <section
      data-dragging={dragging}
      className="crop-marks group relative overflow-hidden rounded-[26px] border border-line bg-sheet transition-[background-color,border-color,transform] duration-300 data-[dragging=true]:scale-[1.005] data-[dragging=true]:border-accent data-[dragging=true]:bg-accent-soft/60"
    >
      <div className="grid items-center gap-7 px-6 py-8 sm:px-10 sm:py-10 md:grid-cols-[1fr_18rem]">
        <div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="group/drop flex items-center gap-4 text-left"
          >
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-ink text-2xl text-paper transition-transform group-hover/drop:-translate-y-0.5 group-data-[dragging=true]:bg-accent group-data-[dragging=true]:text-accent-ink">
              <UploadIcon />
            </span>
            <span className="font-display text-[clamp(1.75rem,4.5vw,2.6rem)] leading-[1.05] tracking-[-0.01em]">
              {t.upload.dropHere}{" "}
              <span className="whitespace-nowrap text-accent underline decoration-accent/40 decoration-2 underline-offset-[6px] group-hover/drop:decoration-accent">
                {t.upload.browse}
              </span>
            </span>
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={boot.upload.accept}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              submit(fromLocalFiles(imagesOf(e.currentTarget.files)));
              e.currentTarget.value = "";
            }}
          />
          <p className="mt-4 text-sm text-muted">{t.upload.pasteHint}</p>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted/90">{t.upload.limits(maxMb, boot.upload.maxDimension)}</p>
        </div>

        <div className="flex flex-col gap-3">
          {boot.drive !== null && (
            <button
              type="button"
              onClick={fromDrive}
              disabled={picking}
              className="flex items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-medium transition-colors hover:border-ink/40 hover:bg-well disabled:opacity-50"
            >
              <DriveIcon className="text-base" />
              {t.upload.fromDrive}
            </button>
          )}
          <label htmlFor={tagsId} className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            {t.upload.batchTags}
          </label>
          <input
            id={tagsId}
            value={tagText}
            onChange={(e) => {
              setTagText(e.currentTarget.value);
              setTagError(null);
            }}
            placeholder={t.upload.batchTagsPlaceholder}
            className="-mt-1.5 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          {tagError !== null && (
            <p role="alert" className="text-xs text-danger">
              {tagError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
