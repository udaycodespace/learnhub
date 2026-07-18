import React, { useEffect, useState } from "react";
import {
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  styled,
  tableCellClasses,
} from "@mui/material";
import axiosInstance from "../common/AxiosInstance";
import PaymentRecords from "./PaymentRecords";
import ActivityLogs from "./ActivityLogs";

const StyledTableCell = styled(TableCell)(({ theme }) => ({
  [`&.${tableCellClasses.head}`]: {
    backgroundColor: theme.palette.common.black,
    color: theme.palette.common.white,
  },
  [`&.${tableCellClasses.body}`]: {
    fontSize: 14,
  },
}));

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  "&:nth-of-type(odd)": {
    backgroundColor: theme.palette.action.hover,
  },
  "&:last-child td, &:last-child th": {
    border: 0,
  },
}));

const AdminHome = () => {
  const [activeSection, setActiveSection] = useState("users");
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");

  const allUsersList = async () => {
    setUsersLoading(true);
    setUsersError("");

    try {
      const response = await axiosInstance.get("api/admin/getallusers", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (response.data.success) {
        setAllUsers(response.data.data || []);
      } else {
        setUsersError(response.data.message || "Unable to load users.");
      }
    } catch (error) {
      setUsersError(
        error.response?.data?.message || "Unable to load users.",
      );
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    allUsersList();
  }, []);

  const deleteUser = async (userId) => {
    const confirmation = window.confirm(
      "Are you sure you want to delete this user?",
    );

    if (!confirmation) return;

    try {
      const response = await axiosInstance.delete(
        `api/admin/deleteuser/${userId}`,
        `api/user/deleteuser/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );

      if (response.data.success) {
        await allUsersList();
      } else {
        window.alert(response.data.message || "Failed to delete the user.");
      }
    } catch (error) {
      window.alert(
        error.response?.data?.message || "Failed to delete the user.",
      );
    }
  };

  return (
    <main>
      <nav
        aria-label="Admin dashboard sections"
        style={{
          display: "flex",
          gap: "8px",
          padding: "16px",
          borderBottom: "1px solid rgba(0,0,0,.12)",
          background: "#fff",
          overflowX: "auto",
        }}
      >
        <Button
          variant={activeSection === "users" ? "contained" : "outlined"}
          color="inherit"
          onClick={() => setActiveSection("users")}
        >
          Users
        </Button>
        <Button
          variant={activeSection === "payments" ? "contained" : "outlined"}
          color="inherit"
          onClick={() => setActiveSection("payments")}
        >
          Payments
        </Button>
      </nav>

      {activeSection === "payments" ? (
        <PaymentRecords />
          variant={
            activeSection === "activity-logs" ? "contained" : "outlined"
          }
          color="inherit"
          onClick={() => setActiveSection("activity-logs")}
        >
          Activity Logs
        </Button>
      </nav>

      {activeSection === "activity-logs" ? (
        <ActivityLogs />
      ) : (
        <section style={{ padding: "20px" }} aria-labelledby="users-title">
          <h1 id="users-title" style={{ marginBottom: "18px" }}>
            Registered users
          </h1>

          {usersError ? (
            <div role="alert" style={{ marginBottom: "16px" }}>
              <p>{usersError}</p>
              <Button variant="outlined" onClick={allUsersList}>
                Try again
              </Button>
            </div>
          ) : null}

          {usersLoading ? (
            <p role="status">Loading users…</p>
          ) : (
            <TableContainer component={Paper}>
              <Table sx={{ minWidth: 700 }} aria-label="Registered users">
                <TableHead>
                  <TableRow>
                    <StyledTableCell>User ID</StyledTableCell>
                    <StyledTableCell align="left">User Name</StyledTableCell>
                    <StyledTableCell align="left">Email</StyledTableCell>
                    <StyledTableCell align="left">Type</StyledTableCell>
                    <StyledTableCell align="left">Action</StyledTableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allUsers.length > 0 ? (
                    allUsers.map((user) => (
                      <StyledTableRow key={user._id}>
                        <StyledTableCell component="th" scope="row">
                          {user._id}
                        </StyledTableCell>
                        <StyledTableCell>{user.name}</StyledTableCell>
                        <StyledTableCell>{user.email}</StyledTableCell>
                        <StyledTableCell>{user.type}</StyledTableCell>
                        <StyledTableCell>
                          <Button
                            onClick={() => deleteUser(user._id)}
                            size="small"
                            color="error"
                          >
                            Delete
                          </Button>
                        </StyledTableCell>
                      </StyledTableRow>
                    ))
                  ) : (
                    <StyledTableRow>
                      <StyledTableCell colSpan={5}>
                        No users found
                      </StyledTableCell>
                    </StyledTableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </section>
      )}
    </main>
  );
};

export default AdminHome;
