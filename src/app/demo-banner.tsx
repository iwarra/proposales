"use client";

import { useState } from "react";
import { FILE_INPUT_ID } from "./upload-form";

const EXAMPLE_FILE_NAME = "example-enquiries.csv";
const EXAMPLE_FILE = `/${EXAMPLE_FILE_NAME}`;

/** Puts the example sheet into the upload form's file input, as if it had been chosen by hand. */
async function selectExampleFile(): Promise<boolean> {
  const input = document.getElementById(FILE_INPUT_ID);
  if (!(input instanceof HTMLInputElement)) return false;
  const response = await fetch(EXAMPLE_FILE);
  if (!response.ok) return false;
  const file = new File([await response.blob()], EXAMPLE_FILE_NAME, {
    type: "text/csv",
  });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function DemoBanner() {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<"idle" | "loading" | "selected" | "failed">("idle");
  if (!open) return null;

  return (
    <div role="region" aria-label="Demo file" className="bg-banner text-banner-text">
      <div className="flex items-start gap-3 px-4 py-3 sm:items-center sm:px-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={state === "loading"}
              onClick={async () => {
                setState("loading");
                setState((await selectExampleFile()) ? "selected" : "failed");
              }}
              className="h-9 rounded-md bg-button px-4 text-sm font-medium text-button-text transition hover:opacity-85 disabled:opacity-60"
            >
              {state === "selected" ? "Example file selected ✓" : "Load example file"}
            </button>
            <a
              href={EXAMPLE_FILE}
              download
              className="inline-flex h-9 items-center rounded-md border border-current px-4 text-sm font-medium text-banner-text no-underline transition hover:bg-current/10"
            >
              Download
            </a>
          </div>
          <p className="text-sm">
            <strong className="font-semibold">Demo:</strong> try the app with a sample sheet of 3 test enquiries.
            {state === "failed" && " The file couldn't be selected. Download it and choose it instead."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="-m-1 shrink-0 rounded-md p-1 text-banner-text transition hover:bg-current/10"
        >
          <svg aria-hidden viewBox="0 0 16 16" width="20" height="20">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
