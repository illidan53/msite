import { Workbench } from "./features/workbench/Workbench";
import { apiClient } from "./shared/apiClient";

export function App() {
  return <Workbench api={apiClient} />;
}
