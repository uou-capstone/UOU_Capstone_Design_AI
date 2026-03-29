import { Navigate, Route, Routes } from "react-router-dom";
import { ClassroomRoute } from "./routes/Classroom";
import { DashboardRoute } from "./routes/Dashboard";
import { SessionRoute } from "./routes/Session";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardRoute />} />
      <Route path="/classrooms/:classroomId" element={<ClassroomRoute />} />
      <Route path="/session/:lectureId" element={<SessionRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
