import "./App.css";
import { useState } from "react";
import LeftPanel, { type AppView } from "./components/LeftPanel";
import Template from "./components/Template";
import Today from "./components/Today";

function App() {
  const [activeView, setActiveView] = useState<AppView>("today");

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <LeftPanel activeView={activeView} onSelectView={setActiveView} />
      <main className="flex-1 bg-[#F8FAFC]">
        {activeView === "today" ? <Today /> : <Template />}
      </main>
    </div>
  );
}

export default App;
