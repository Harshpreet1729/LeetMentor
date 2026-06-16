import React from "react";
import { createRoot } from "react-dom/client";
import type { ProblemContext, SupportedLanguage } from "@leetcode-assistant/shared";
import { AssistantSidebar } from "./sidebar/AssistantSidebar";
import { FloatingAssistantButton } from "./components/FloatingAssistantButton";
import { extractLiveEditorSnapshotFromPage, extractProblemFromPage } from "./lib/leetcodeExtractor";

type AssistantRequestMessage =
  | { type: "leetcode-assistant:get-problem" }
  | { type: "leetcode-assistant:toggle-sidebar"; open?: boolean };

interface EditorSnapshotState {
  code: string;
  language: SupportedLanguage | null;
}

async function mountAssistant() {
  if (document.getElementById("leetcode-ai-assistant-root")) {
    return;
  }

  const rootElement = document.createElement("div");
  rootElement.id = "leetcode-ai-assistant-root";
  const shadowRoot = rootElement.attachShadow({ mode: "open" });
  const styleTag = document.createElement("style");

  try {
    const stylesheetResponse = await fetch(chrome.runtime.getURL("assets/contentScript.css"));
    styleTag.textContent = await stylesheetResponse.text();
  } catch (error) {
    console.error("Failed to load assistant styles.", error);
  }

  shadowRoot.appendChild(styleTag);

  const appMountNode = document.createElement("div");
  appMountNode.id = "leetcode-ai-assistant-shadow-root";
  shadowRoot.appendChild(appMountNode);
  document.body.appendChild(rootElement);

  function App() {
    const [isOpen, setIsOpen] = React.useState(false);
    const [problem, setProblem] = React.useState<ProblemContext | null>(extractProblemFromPage());
    const [editorSnapshot, setEditorSnapshot] = React.useState<EditorSnapshotState>({
      code: "",
      language: null
    });
    const latestProblemRef = React.useRef(problem);

    const refreshEditorSnapshot = React.useCallback(async () => {
      const snapshot = await extractLiveEditorSnapshotFromPage();
      setEditorSnapshot(snapshot);
      return snapshot;
    }, []);

    React.useEffect(() => {
      void refreshEditorSnapshot();

      const observer = new MutationObserver(() => {
        setProblem(extractProblemFromPage());
      });

      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, [refreshEditorSnapshot]);

    React.useEffect(() => {
      latestProblemRef.current = problem;
    }, [problem]);

    React.useEffect(() => {
      if (!isOpen) {
        return;
      }

      void refreshEditorSnapshot();
      const interval = window.setInterval(() => {
        void refreshEditorSnapshot();
      }, 1500);

      return () => window.clearInterval(interval);
    }, [isOpen, refreshEditorSnapshot]);

    React.useEffect(() => {
      const handleMessage = (
        message: AssistantRequestMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
      ) => {
        if (message.type === "leetcode-assistant:get-problem") {
          void (async () => {
            const snapshot = await refreshEditorSnapshot();
            sendResponse({
              ok: true,
              isProblemPage: /\/problems\//.test(window.location.pathname),
              problem: latestProblemRef.current,
              editorCode: snapshot.code,
              editorLanguage: snapshot.language
            });
          })();
          return true;
        }

        if (message.type === "leetcode-assistant:toggle-sidebar") {
          setIsOpen((previous) => (typeof message.open === "boolean" ? message.open : !previous));
          sendResponse({ ok: true });
        }
      };

      chrome.runtime.onMessage.addListener(handleMessage);
      return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, [refreshEditorSnapshot]);

    const isProblemPage = /\/problems\//.test(window.location.pathname);
    if (!isProblemPage) {
      return null;
    }

    return (
      <>
        <FloatingAssistantButton isOpen={isOpen} onToggle={() => setIsOpen((previous) => !previous)} />
        {isOpen ? <AssistantSidebar currentProblem={problem} liveCode={editorSnapshot.code} detectedLanguage={editorSnapshot.language} /> : null}
      </>
    );
  }

  createRoot(appMountNode).render(<App />);
}

void mountAssistant();
