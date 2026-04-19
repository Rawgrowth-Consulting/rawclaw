"use client";

import { useCallback, useEffect, useState } from "react";

export type KnowledgeFileRow = {
  id: string;
  organization_id: string;
  title: string;
  tags: string[];
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
};

export function useKnowledge() {
  const [files, setFiles] = useState<KnowledgeFileRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/knowledge");
    const body = (await res.json()) as { files?: KnowledgeFileRow[] };
    setFiles(body.files ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File, tags: string[], title?: string) => {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (title) fd.append("title", title);
        if (tags.length) fd.append("tags", tags.join(","));
        const res = await fetch("/api/knowledge", { method: "POST", body: fd });
        if (!res.ok) {
          const { error } = (await res.json()) as { error?: string };
          throw new Error(error ?? "upload failed");
        }
        await refresh();
      } finally {
        setUploading(false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const updateTags = useCallback(
    async (id: string, tags: string[]) => {
      await fetch(`/api/knowledge/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      await refresh();
    },
    [refresh],
  );

  const fetchContent = useCallback(async (id: string): Promise<string> => {
    const res = await fetch(`/api/knowledge/${id}`);
    if (!res.ok) throw new Error("fetch failed");
    const body = (await res.json()) as { content?: string };
    return body.content ?? "";
  }, []);

  return {
    files,
    loaded,
    uploading,
    refresh,
    upload,
    remove,
    updateTags,
    fetchContent,
  };
}
