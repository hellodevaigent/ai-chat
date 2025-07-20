"use client";

import useSWR, { useSWRConfig } from "swr";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { ChatHeader } from "@/components/chat/chat-header";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "../artifact/artifact";
import { MultimodalInput } from "../multimodal-input";
import { Messages } from "../message/messages";
import { useArtifact, useArtifactSelector } from "@/hooks/use-artifact";
import { unstable_serialize } from "swr/infinite";
import { getChatHistoryPaginationKey } from "../sidebar/sidebar-history";
import { toast } from "../common/toast";
import { useSearchParams } from "next/navigation";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { ChatSDKError } from "@/lib/errors";
import { useDataStream } from "../data-stream-provider";
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { AnimatePresence, motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Session } from "next-auth";
import type { Vote } from "@/lib/db/schema";
import type { VisibilityType } from "../visibility-selector";
import type { Attachment, ChatMessage } from "@/lib/types";
import { useSidebar } from "../ui/sidebar";
import { useBreakpoint } from "@/hooks/use-breakpoint";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  session,
  autoResume,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: Session;
  autoResume: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const isMobile = useBreakpoint(1024)
  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();
  const { artifact, resetArtifact } = useArtifact();

  const [input, setInput] = useState<string>("");

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({
          type: "error",
          description: error.message,
        });
      }
    },
  });

  useEffect(() => {
    resetArtifact();
  }, [id, resetArtifact]);

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Array<Vote>>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const chatPanel = (
    <div className="flex flex-col min-w-0 h-dvh bg-background">
      <ChatHeader
        chatId={id}
        selectedModelId={initialChatModel}
        selectedVisibilityType={initialVisibilityType}
        isReadonly={isReadonly}
        session={session}
      />

      <Messages
        chatId={id}
        status={status}
        votes={votes}
        messages={messages}
        setMessages={setMessages}
        regenerate={regenerate}
        isReadonly={isReadonly}
        artifactStatus={artifact.status}
      />

      <form className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl">
        {!isReadonly && (
          <MultimodalInput
            chatId={id}
            input={input}
            setInput={setInput}
            status={status}
            stop={stop}
            attachments={attachments}
            setAttachments={setAttachments}
            messages={messages}
            setMessages={setMessages}
            sendMessage={sendMessage}
            selectedVisibilityType={visibilityType}
          />
        )}
      </form>
    </div>
  );

  const artifactPanel = (
    <Artifact
      status={status}
      stop={stop}
      sendMessage={sendMessage}
      setMessages={setMessages}
    />
  );

  if (isMobile) {
    return (
      <>
        {chatPanel}
        <AnimatePresence>
          {isArtifactVisible && (
            <motion.div
              className="fixed inset-0 z-50 bg-background"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {artifactPanel}
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <DesktopResizablePanel
      isArtifactVisible={isArtifactVisible}
      chatPanel={chatPanel}
      artifactPanel={artifactPanel}
    />
  );
}

interface DesktopResizablePanelProps {
  isArtifactVisible: boolean;
  chatPanel: ReactNode;
  artifactPanel: ReactNode;
}

function DesktopResizablePanel({
  isArtifactVisible,
  chatPanel,
  artifactPanel,
}: DesktopResizablePanelProps) {
  const { setOpen } = useSidebar();
  const { setArtifact } = useArtifact();
  const artifactPanelRef = useRef<ImperativePanelHandle>(null);
  
  // State untuk melacak apakah panel sudah pernah dibuka
  const [hasBeenExpanded, setHasBeenExpanded] = useState(false);

  useEffect(() => {
    const panel = artifactPanelRef.current;
    if (!panel) return;

    if (isArtifactVisible) {
      panel.expand();
    } else {
      panel.collapse();
    }

    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  }, [isArtifactVisible]);

  // Menentukan minSize berdasarkan apakah sudah pernah dibuka
  const getMinSize = () => {
    return hasBeenExpanded ? 10 : 50;
  };

  return (
    <div className="h-full w-full">
      <PanelGroup direction="horizontal">
        <Panel
          defaultSize={60}
          minSize={30}
          className="flex flex-col"
        >
          {chatPanel}
        </Panel>

        {isArtifactVisible && (
          <PanelResizeHandle className="w-2 bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 transition-colors" />
        )}

        <Panel
          ref={artifactPanelRef}
          id="artifact-panel"
          defaultSize={0}
          minSize={getMinSize()}
          maxSize={70}
          collapsible
          className="artifact-panel border-l relative transition-all"
          onResize={() => {
            const panel = document.querySelector(".artifact-panel") as HTMLElement;
            if (panel) {
              panel.style.transition = "none";
            }
          }}
          onCollapse={() => {
            setOpen(true)
            setArtifact((currentArtifact) => ({
              ...currentArtifact,
              isVisible: false,
            }));
            const panel = document.querySelector(".artifact-panel") as HTMLElement;
            if (panel) {
              panel.style.transition = "";
            }
          }}
          onExpand={() => {
            setOpen(false)
            // Set hasBeenExpanded menjadi true saat panel pertama kali di-expand
            setHasBeenExpanded(true);
            const panel = document.querySelector(".artifact-panel") as HTMLElement;
            if (panel) {
              panel.style.transition = "";
            }
          }}
        >
          {isArtifactVisible && artifactPanel}
        </Panel>
      </PanelGroup>
    </div>
  );
}
