import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import type { BootConfig, SignedInBoot } from "../../shared/api";
import type { AssetId } from "../../shared/domain";
import { type AssetQuery, queryFromSearch, queryToSearch } from "../../shared/query";
import { ApiError, deleteAsset, listAssets, updateAsset } from "../api";
import { assetsReducer, initialAssets } from "../catalog";
import { useI18n } from "../i18n";
import { createUploadQueue, type UploadItem } from "../uploads";
import { Header } from "./Header";
import { Intake } from "./Intake";
import { Library } from "./Library";
import { UploadList } from "./UploadList";

export function Dashboard({ boot, session }: { readonly boot: BootConfig; readonly session: SignedInBoot }) {
  const { t } = useI18n();
  const [catalog, dispatch] = useReducer(assetsReducer, session.assets, initialAssets);
  const [uploads, setUploads] = useState<readonly UploadItem[]>([]);
  const [query, setQuery] = useState<AssetQuery>(() => queryFromSearch(new URLSearchParams(location.search)));

  const queue = useMemo(
    () =>
      createUploadQueue({
        maxBytes: boot.upload.maxBytes,
        onChange: setUploads,
        onUploaded: (asset) => {
          dispatch({ type: "uploaded", asset });
        },
      }),
    [boot.upload.maxBytes],
  );

  const messageOf = useCallback(
    (error: unknown): string => {
      if (!(error instanceof ApiError)) return t.errors.network;
      return error.issue === null ? t.errors[error.code] : t.inputIssues[error.issue];
    },
    [t],
  );

  useEffect(() => {
    if (session.assets !== null) return;
    listAssets().then(
      (assets) => {
        dispatch({ type: "loaded", assets });
      },
      (error: unknown) => {
        dispatch({ type: "failed", error: messageOf(error) });
      },
    );
  }, [session.assets, messageOf]);

  const changeQuery = (next: AssetQuery) => {
    setQuery(next);
    const search = queryToSearch(next).toString();
    history.replaceState(null, "", `${location.pathname}${search === "" ? "" : `?${search}`}`);
  };

  const saveTags = async (id: AssetId, tags: readonly string[]): Promise<string | null> => {
    try {
      dispatch({ type: "updated", asset: await updateAsset(id, { tags }) });
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") dispatch({ type: "removed", id });
      return messageOf(error);
    }
  };

  const remove = async (id: AssetId): Promise<string | null> => {
    try {
      await deleteAsset(id);
      dispatch({ type: "removed", id });
      return null;
    } catch (error) {
      return messageOf(error);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <Header appName={boot.appName} user={session.user} localeFixed={boot.localeFixed} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
        <Intake
          boot={boot}
          user={session.user}
          onFiles={(files, tags) => {
            queue.enqueue(files, tags);
          }}
        />
        <UploadList items={uploads} queue={queue} />
        <Library
          assets={catalog.assets}
          loading={catalog.loading}
          error={catalog.error}
          query={query}
          onQuery={changeQuery}
          onSaveTags={saveTags}
          onDelete={remove}
        />
      </main>
    </div>
  );
}
