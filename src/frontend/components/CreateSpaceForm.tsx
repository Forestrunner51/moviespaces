import { useState } from "react";

export default function CreateSpaceForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      // Direct connection to your .NET backend endpoint
      const response = await fetch("http://localhost:5123/api/moviespaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, description }),
      });

      if (!response.ok) {
        throw new Error("Failed to save the space.");
      }

      const data = await response.json();
      setMessage(`Success! Created space with ID: ${data.id}`);
      setTitle("");
      setDescription("");
    } catch (error) {
      setMessage("Error connecting to the backend.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "400px" }}>
      <h3>Create a Movie Space</h3>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "10px" }}>
          <label style={{ display: "block" }}>Title:</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={{ width: "100%", padding: "8px" }}
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label style={{ display: "block" }}>Description:</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            style={{ width: "100%", padding: "8px" }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{ padding: "10px 15px" }}
        >
          {loading ? "Saving..." : "Save Space"}
        </button>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
}
