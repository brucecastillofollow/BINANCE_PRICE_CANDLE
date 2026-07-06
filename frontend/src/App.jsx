import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminViews from "./pages/AdminViews.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import InviteAccept from "./pages/InviteAccept.jsx";
import MainLayout from "./pages/MainLayout.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
        </Route>
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/admin-views" element={<AdminViews />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
