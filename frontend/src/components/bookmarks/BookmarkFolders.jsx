import React, { useCallback, useEffect, useState } from "react";
import axiosInstance from "../common/AxiosInstance";
import "./BookmarkFolders.css";

const BookmarkFolders = () => {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newName, setNewName] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [addCourseId, setAddCourseId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await axiosInstance.get("/api/bookmark-folders");
      setFolders(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load folders.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearMessages = () => { setError(""); setNotice(""); };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) { setError("Name is required."); return; }
    setSaving(true); clearMessages();
    try {
      await axiosInstance.post("/api/bookmark-folders", { name: newName.trim() });
      setNewName(""); setNotice("Folder created.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not create folder.");
    } finally { setSaving(false); }
  };

  const handleRename = async (folderId) => {
    if (!editName.trim()) return;
    setSaving(true); clearMessages();
    try {
      await axiosInstance.put(`/api/bookmark-folders/${folderId}`, { name: editName.trim() });
      setEditingId(null); setNotice("Folder renamed.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not rename folder.");
    } finally { setSaving(false); }
  };

  const handleDelete = async (folderId) => {
    if (!window.confirm("Delete this folder?")) return;
    clearMessages();
    try {
      await axiosInstance.delete(`/api/bookmark-folders/${folderId}`);
      setNotice("Folder deleted.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete folder.");
    }
  };

  const handleAddCourse = async (folderId) => {
    if (!addCourseId.trim()) return;
    setSaving(true); clearMessages();
    try {
      await axiosInstance.post(`/api/bookmark-folders/${folderId}/courses`, { courseId: addCourseId.trim() });
      setAddCourseId(""); setNotice("Course added.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add course.");
    } finally { setSaving(false); }
  };

  const handleRemoveCourse = async (folderId, courseId) => {
    clearMessages();
    try {
      await axiosInstance.delete(`/api/bookmark-folders/${folderId}/courses/${courseId}`);
      setNotice("Course removed.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not remove course.");
    }
  };

  if (loading) return <section className="bf-container"><p>Loading…</p></section>;

  return (
    <section className="bf-container" aria-labelledby="bf-title">
      <header className="bf-header">
        <h2 id="bf-title">Bookmark Folders</h2>
        <form className="bf-create-form" onSubmit={handleCreate}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 60))}
            placeholder="New folder name…"
          />
          <button type="submit" className="bf-btn bf-btn-primary" disabled={saving}>
            {saving ? "…" : "Create"}
          </button>
        </form>
      </header>

      {error && <div className="bf-error" role="alert">{error}</div>}
      {notice && <div className="bf-notice" role="status">{notice}</div>}

      {folders.length === 0 ? (
        <div className="bf-empty">
          <strong>No folders yet</strong>
          <p>Create a folder to organize your bookmarked courses.</p>
        </div>
      ) : (
        folders.map((folder) => (
          <div key={folder.id} className="bf-folder">
            <div
              className="bf-folder-header"
              onClick={() => setExpandedId(expandedId === folder.id ? null : folder.id)}
              role="button"
              tabIndex={0}
              aria-expanded={expandedId === folder.id}
            >
              {editingId === folder.id ? (
                <div style={{ display: "flex", gap: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value.slice(0, 60))}
                    onKeyDown={(e) => e.key === "Enter" && handleRename(folder.id)}
                    autoFocus
                    style={{ padding: "0.3rem 0.5rem", border: "1px solid #d1d5db", borderRadius: 4, fontSize: "0.88rem" }}
                  />
                  <button className="bf-btn bf-btn-primary" onClick={() => handleRename(folder.id)} disabled={saving}>Save</button>
                  <button className="bf-btn bf-btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div>
                    <h3>{folder.name}</h3>
                    <span className="bf-count">{folder.courseCount} course{folder.courseCount !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="bf-folder-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="bf-btn bf-btn-ghost" onClick={() => { setEditingId(folder.id); setEditName(folder.name); }}>Rename</button>
                    <button className="bf-btn-danger" onClick={() => handleDelete(folder.id)}>Delete</button>
                  </div>
                </>
              )}
            </div>

            {expandedId === folder.id && (
              <div className="bf-course-list">
                {folder.courses.length === 0 ? (
                  <p style={{ color: "#6b7280", fontSize: "0.82rem", padding: "0.5rem 0" }}>No courses in this folder yet.</p>
                ) : (
                  folder.courses.map((c) => (
                    <div key={c.id} className="bf-course-item">
                      <div>
                        <strong>{c.title}</strong>
                        <span className="bf-meta"> · {c.educator} · {c.category}</span>
                      </div>
                      <button className="bf-btn-danger" onClick={() => handleRemoveCourse(folder.id, c.id)}>Remove</button>
                    </div>
                  ))
                )}
                <div className="bf-add-course-form">
                  <input
                    type="text"
                    value={addCourseId}
                    onChange={(e) => setAddCourseId(e.target.value)}
                    placeholder="Paste a Course ID…"
                  />
                  <button className="bf-btn bf-btn-primary" onClick={() => handleAddCourse(folder.id)} disabled={saving || !addCourseId.trim()}>Add</button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
};

export default BookmarkFolders;
