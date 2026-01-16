const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  // Get phone number from query
  const { num } = req.query;
  
  // If no number provided
  if (!num) {
    return res.status(400).json({
      error: "Phone number is required",
      usage: "https://your-app.vercel.app/?num=9876543210"
    });
  }
  
  try {
    // Clean the number (remove non-digits)
    const cleanNum = num.toString().replace(/\D/g, '');
    
    // Call the external API
    const apiUrl = `https://source-code-api.vercel.app/?num=${cleanNum}`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    // Get the response text
    const responseText = await response.text();
    
    // Try to parse as JSON
    let jsonData;
    try {
      jsonData = JSON.parse(responseText);
    } catch {
      // If not JSON, return the raw response
      jsonData = { raw: responseText };
    }
    
    // Send ONLY the API response data
    return res.status(200).json(jsonData);
    
  } catch (error) {
    console.error('Error:', error);
    
    return res.status(500).json({
      error: "Failed to fetch data",
      message: error.message
    });
  }
};
