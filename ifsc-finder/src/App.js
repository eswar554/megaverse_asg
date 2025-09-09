import React, { useState } from "react";
import "./App.css";

function App() {
  const [ifsc, setIfsc] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!ifsc.trim()) {
      setError("⚠ Please enter an IFSC Code.");
      setResults([]);
      return;
    }

    try {
      const response = await fetch("/banks.json");
      const banks = await response.json();

      const matches = banks.filter(
        (bank) => bank.ifscCode.toUpperCase() === ifsc.toUpperCase()
      );

      if (matches.length > 0) {
        setResults(matches);
        setError("");
      } else {
        setError("❌ No bank found with that IFSC Code.");
        setResults([]);
      }
    } catch (err) {
      console.error(err);
      setError("⚠ Error loading data.");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="app-container">
      <h1>🔎 IFSC Code Finder</h1>

      <input
        type="text"
        value={ifsc}
        onChange={(e) => setIfsc(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter IFSC Code"
      />
      <button onClick={handleSearch}>Search</button>

      {error && <p className="error">{error}</p>}

      {results.length > 0 && (
        <div className="result-box">
          <h3>Bank Details:</h3>
          {results.map((bank, index) => (
            <div key={index} className="bank-card">
              <p><strong>Bank Name:</strong> {bank.bankName}</p>
              <p><strong>Branch:</strong> {bank.branchName}</p>
              <p><strong>District:</strong> {bank.district}</p>
              <p><strong>State:</strong> {bank.state}</p>
              <p><strong>Address:</strong> {bank.address}</p>
              <p><strong>MICR Code:</strong> {bank.micrCode}</p>
              <p><strong>Contact:</strong> {bank.contact}</p>
              <p><strong>Branch Details:</strong> {bank.branchDetails}</p>
              <hr />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
