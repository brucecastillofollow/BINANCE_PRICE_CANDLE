import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminViews from "./pages/AdminViews.jsx";
import Dashboard from "./pages/Dashboard.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/admin-views" element={<AdminViews />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
