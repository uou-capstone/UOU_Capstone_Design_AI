import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RequireRole } from "./auth/RequireRole";
import { ClassroomRoute } from "./routes/Classroom";
import { ClassroomReportRoute } from "./routes/ClassroomReport";
import { DashboardRoute } from "./routes/Dashboard";
import { LoginRoute } from "./routes/Login";
import { SessionRoute } from "./routes/Session";
import { SignupRoute } from "./routes/Signup";
import { VerifyEmailRoute } from "./routes/VerifyEmail";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/signup" element={<SignupRoute />} />
      <Route path="/verify-email" element={<VerifyEmailRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/classrooms/:classroomId" element={<ClassroomRoute />} />
        <Route
          path="/classrooms/:classroomId/report"
          element={
            <RequireRole allow={["teacher"]}>
              <ClassroomReportRoute />
            </RequireRole>
          }
        />
        <Route path="/session/:lectureId" element={<SessionRoute />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
