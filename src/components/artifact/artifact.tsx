import useSWR, { useSWRConfig } from "swr";
import { formatDistance } from "date-fns";
import { memo, useCallback, useEffect, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";
import { fetcher } from "@/lib/utils";
import { Toolbar } from "../toolbar";
import { VersionFooter } from "./version-footer";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactCloseButton } from "./artifact-close-button";
import { useArtifact } from "@/hooks/use-artifact";
import { imageArtifact } from "@/artifacts/image/client";
import { codeArtifact } from "@/artifacts/code/client";
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import type { Document } from "@/lib/db/schema";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatMessage } from "@/lib/types";

export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
];
export type ArtifactKind = (typeof artifactDefinitions)[number]["kind"];

export interface UIArtifact {
  title: string;
  documentId: string;
  kind: ArtifactKind;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle";
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

function PureArtifact({
  status,
  stop,
  sendMessage,
  setMessages,
}: {
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();

  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Array<Document>>(
    artifact.documentId !== "init" && artifact.status !== "streaming"
      ? `/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);

  useEffect(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        setArtifact((currentArtifact) => ({
          ...currentArtifact,
          content: mostRecentDocument.content ?? "",
        }));
      }
    }
  }, [documents, setArtifact]);

  useEffect(() => {
    mutateDocuments();
  }, [artifact.status, mutateDocuments]);

  const { mutate } = useSWRConfig();
  const [isContentDirty, setIsContentDirty] = useState(false);

  const handleContentChange = useCallback(
    (updatedContent: string) => {
      if (!artifact) return;

      mutate<Array<Document>>(
        `/api/document?id=${artifact.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) return undefined;

          const currentDocument = currentDocuments.at(-1);

          if (!currentDocument || !currentDocument.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          if (currentDocument.content !== updatedContent) {
            await fetch(`/api/document?id=${artifact.documentId}`, {
              method: "POST",
              body: JSON.stringify({
                title: artifact.title,
                content: updatedContent,
                kind: artifact.kind,
              }),
            });

            setIsContentDirty(false);

            const newDocument = {
              ...currentDocument,
              content: updatedContent,
              createdAt: new Date(),
            };

            return [...currentDocuments, newDocument];
          }
          return currentDocuments;
        },
        { revalidate: false }
      );
    },
    [artifact, mutate]
  );

  const debouncedHandleContentChange = useDebounceCallback(
    handleContentChange,
    2000
  );

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean) => {
      if (document && updatedContent !== document.content) {
        setIsContentDirty(true);

        if (debounce) {
          debouncedHandleContentChange(updatedContent);
        } else {
          handleContentChange(updatedContent);
        }
      }
    },
    [document, debouncedHandleContentChange, handleContentChange]
  );

  function getDocumentContentById(index: number) {
    if (!documents) return "";
    if (!documents[index]) return "";
    return documents[index].content ?? "";
  }

  const handleVersionChange = (type: "next" | "prev" | "toggle" | "latest") => {
    if (!documents) return;

    if (type === "latest") {
      setCurrentVersionIndex(documents.length - 1);
      setMode("edit");
    }

    if (type === "toggle") {
      setMode((mode) => (mode === "edit" ? "diff" : "edit"));
    }

    if (type === "prev") {
      if (currentVersionIndex > 0) {
        setCurrentVersionIndex((index) => index - 1);
      }
    } else if (type === "next") {
      if (currentVersionIndex < documents.length - 1) {
        setCurrentVersionIndex((index) => index + 1);
      }
    }
  };

  const [isToolbarVisible, setIsToolbarVisible] = useState(false);

  /*
   * NOTE: if there are no documents, or if
   * the documents are being fetched, then
   * we mark it as the current version.
   */

  const isCurrentVersion =
    documents && documents.length > 0
      ? currentVersionIndex === documents.length - 1
      : true;

  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );

  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }

  useEffect(() => {
    if (artifact.documentId !== "init") {
      if (artifactDefinition.initialize) {
        artifactDefinition.initialize({
          documentId: artifact.documentId,
          setMetadata,
        });
      }
    }
  }, [artifact.documentId, artifactDefinition, setMetadata]);

  return (
    artifact.isVisible && (
      <div
        data-testid="artifact"
        className="w-full relative dark:bg-muted bg-background h-dvh flex flex-col md:border-l dark:border-zinc-700 border-zinc-200 overflow-hidden"
      >
        <div className="p-2 flex flex-row justify-between items-start">
          <div className="flex flex-row gap-4 items-start">
            <ArtifactCloseButton />

            <div className="flex flex-col">
              <div className="font-medium">{artifact.title}</div>

              {isContentDirty ? (
                <div className="text-sm text-muted-foreground">
                  Saving changes...
                </div>
              ) : document ? (
                <div className="text-sm text-muted-foreground">
                  {`Updated ${formatDistance(
                    new Date(document.createdAt),
                    new Date(),
                    {
                      addSuffix: true,
                    }
                  )}`}
                </div>
              ) : (
                <div className="w-32 h-3 mt-2 bg-muted-foreground/20 rounded-md animate-pulse" />
              )}
            </div>
          </div>

          <ArtifactActions
            artifact={artifact}
            currentVersionIndex={currentVersionIndex}
            handleVersionChange={handleVersionChange}
            isCurrentVersion={isCurrentVersion}
            mode={mode}
            metadata={metadata}
            setMetadata={setMetadata}
          />
        </div>

        <div className="dark:bg-muted bg-background h-full overflow-y-scroll !max-w-full items-center">
          <artifactDefinition.content
            title={artifact.title}
            content={
              isCurrentVersion
                ? artifact.content
                : getDocumentContentById(currentVersionIndex)
            }
            mode={mode}
            status={artifact.status}
            currentVersionIndex={currentVersionIndex}
            suggestions={[]}
            onSaveContent={saveContent}
            isInline={false}
            isCurrentVersion={isCurrentVersion}
            getDocumentContentById={getDocumentContentById}
            isLoading={isDocumentsFetching && !artifact.content}
            metadata={metadata}
            setMetadata={setMetadata}
          />

          {isCurrentVersion && (
            <Toolbar
              isToolbarVisible={isToolbarVisible}
              setIsToolbarVisible={setIsToolbarVisible}
              sendMessage={sendMessage}
              status={status}
              stop={stop}
              setMessages={setMessages}
              artifactKind={artifact.kind}
            />
          )}
        </div>

        {!isCurrentVersion && (
          <VersionFooter
            currentVersionIndex={currentVersionIndex}
            documents={documents}
            handleVersionChange={handleVersionChange}
          />
        )}
      </div>
    )
  );
}

export const Artifact = memo(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  return true;
});
