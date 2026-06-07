import { useEffect, useState } from "react";

interface MovieSpace {
  id: number;
  title: string;
  description: string;
  createdAt: string;
}

export default function SpaceList() {
  const [spaces, setSpaces] = useState<MovieSpace[]>([]);

  useEffect(() => {
    // Fetch data from the backend GET endpoint
    fetch("http://localhost:5123/api/moviespaces")
      .then((res) => res.json())
      .then((data) => setSpaces(data))
      .catch((err) => console.error("Error fetching:", err));
  }, []);

  return (
    <div style={{ padding: "20px" }}>
      <h3>Active Movie Spaces</h3>
      {spaces.length === 0 ? (
        <p>No spaces found.</p>
      ) : (
        <ul>
          {spaces.map((space) => (
            <li
              key={space.id}
              style={{
                marginBottom: "15px",
                borderBottom: "1px solid #ccc",
                paddingBottom: "10px",
              }}
            >
              <strong>{space.title}</strong>
              <p>{space.description}</p>
              <small style={{ color: "gray" }}>
                Created: {new Date(space.createdAt).toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
