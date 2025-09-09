const puppeteer = require("puppeteer")
const fs = require("fs").promises
const path = require("path")

async function getBankOptions(page) {
  const bankSelector =
    "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(3) > div > select"
  const bankOptions = await page.evaluate((sel) => {
    const select = document.querySelector(sel)
    if (!select) return []

    const optionElements = select.querySelectorAll("option")
    return Array.from(optionElements)
      .map((option) => ({
        value: option.value,
        text: option.textContent.trim(),
      }))
      .filter(
        (opt) =>
          opt.value &&
          opt.value !== "" &&
          !opt.text.toLowerCase().includes("select") &&
          !opt.text.toLowerCase().includes("choose") &&
          !opt.text.toLowerCase().includes("see") &&
          opt.text !== "State" &&
          opt.text !== "District" &&
          opt.text !== "Branch",
      )
  }, bankSelector)

  return { selector: bankSelector, options: bankOptions }
}

class BankIFSCScraper {
  constructor() {
    this.browser = null
    this.page = null
    this.baseUrl = "https://bankifsccode.com/"
    this.data = []
    this.requestDelay = 2000 // 2 second delay between requests
    this.maxRetries = 3
    this.totalRecords = 0
    this.failedRecords = 0
  }

  async initialize() {
    console.log("🚀 Initializing browser...")
    this.browser = await puppeteer.launch({
      headless: false, // Set to true for production
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--disable-extensions",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
      ],
      protocolTimeout: 300000, // Increased from 180000 to 300000 (5 minutes)
      timeout: 120000, // Increased from 90000 to 120000 (2 minutes)
    })

    this.page = await this.browser.newPage()

    // Set user agent to avoid being blocked
    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    )

    this.page.setDefaultTimeout(120000) // Increased from 90000 to 120000
    this.page.setDefaultNavigationTimeout(180000) // Increased from 120000 to 180000 (3 minutes)

    try {
      await this.page.setRequestInterception(true)
      this.page.on("request", (req) => {
        const resourceType = req.resourceType()
        // Only block images to reduce load, allow CSS and fonts
        if (resourceType === "image") {
          req.abort()
        } else {
          req.continue()
        }
      })
    } catch (error) {
      console.log("⚠️ Request interception setup failed, continuing without it:", error.message)
    }

    console.log("✅ Browser initialized successfully")
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async waitForSelector(selector, timeout = 10000) {
    try {
      await this.page.waitForSelector(selector, { timeout })
      return true
    } catch (error) {
      return false
    }
  }

  async selectOptionByValue(selectSelector, optionValue, retries = 0) {
    console.log(`    🔄 Selecting option: ${optionValue}`)

    try {
      await this.page.waitForSelector(selectSelector, { timeout: 15000 }) // Increased from 10000

      const options = await this.page.evaluate((sel) => {
        const select = document.querySelector(sel)
        if (!select) return null
        return Array.from(select.options).map((opt) => ({
          value: opt.value,
          text: opt.textContent.trim(),
        }))
      }, selectSelector)

      console.log(`[v0] Available options for ${selectSelector}:`, options?.slice(0, 3))

      let success = false

      // Method 1: Direct value selection
      try {
        const result = await this.page.select(selectSelector, optionValue)
        if (result && result.length > 0) {
          success = true
          console.log(`[v0] Method 1 success: selected ${optionValue}`)
        }
      } catch (e) {
        console.log(`[v0] Method 1 failed:`, e.message)
      }

      // Method 2: If direct selection fails, try by text content
      if (!success) {
        try {
          await this.page.evaluate(
            (sel, val) => {
              const select = document.querySelector(sel)
              if (select) {
                // Find option by value or text
                for (const option of select.options) {
                  if (option.value === val || option.textContent.trim().includes(val)) {
                    select.value = option.value
                    select.dispatchEvent(new Event("change", { bubbles: true }))
                    return true
                  }
                }
              }
              return false
            },
            selectSelector,
            optionValue,
          )
          success = true
          console.log(`[v0] Method 2 success: selected by text matching`)
        } catch (e) {
          console.log(`[v0] Method 2 failed:`, e.message)
        }
      }

      // Method 3: Click-based selection
      if (!success) {
        try {
          await this.page.click(selectSelector)
          await this.page.waitForTimeout(500)

          // Try to find and click the option
          const optionSelector = `${selectSelector} option[value="${optionValue}"]`
          await this.page.click(optionSelector)
          success = true
          console.log(`[v0] Method 3 success: clicked option`)
        } catch (e) {
          console.log(`[v0] Method 3 failed:`, e.message)
        }
      }

      if (!success) {
        throw new Error(`All selection methods failed for ${optionValue}`)
      }

      await this.page.waitForTimeout(4000) // Increased from 3000

      if (selectSelector.includes("form:nth-child(3)")) {
        // This is bank selection - wait for states dropdown to become available
        try {
          await this.page.waitForFunction(
            () => {
              const stateSelect = document.querySelector(
                "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(4) > div > select",
              )
              return stateSelect && stateSelect.options.length > 1
            },
            { timeout: 15000 }, // Increased from 10000
          )
          console.log(`[v0] Bank selection successful - states dropdown loaded`)
        } catch (e) {
          console.log(`[v0] Warning: States dropdown not loaded after bank selection`)
        }
      } else if (selectSelector.includes("form:nth-child(4)")) {
        try {
          await this.page.waitForFunction(
            () => {
              const districtSelect = document.querySelector(
                "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(5) > div > select",
              )
              return districtSelect && districtSelect.options.length > 1
            },
            { timeout: 12000 }, // Increased from 8000
          )
          console.log(`[v0] State selection successful - districts dropdown loaded`)
        } catch (e) {
          console.log(`[v0] Warning: Districts dropdown not loaded after state selection`)
        }
      } else if (selectSelector.includes("form:nth-child(5)")) {
        try {
          await this.page.waitForFunction(
            () => {
              const branchSelect = document.querySelector(
                "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(6) > div > select",
              )
              return branchSelect && branchSelect.options.length > 1
            },
            { timeout: 12000 }, // Increased from 8000
          )
          console.log(`[v0] District selection successful - branches dropdown loaded`)
        } catch (e) {
          console.log(`[v0] Warning: Branches dropdown not loaded after district selection`)
        }
      }

      return true // Return success instead of selected value
    } catch (error) {
      console.log(`❌ Selection error: ${error.message}`)

      if (error.message.includes("timeout") && retries < this.maxRetries) {
        console.log(`🔄 Retrying selection (${retries + 1}/${this.maxRetries})...`)
        await this.sleep(2000)
        return this.selectOptionByValue(selectSelector, optionValue, retries + 1)
      }

      throw error
    }
  }

  async getAllOptionsWithValues(selectSelector) {
    try {
      const selectorFound = await this.waitForSelector(selectSelector, 15000) // Increased from default
      if (!selectorFound) {
        return []
      }

      const options = await this.page.evaluate((sel) => {
        const select = document.querySelector(sel)
        if (!select) return []

        const optionElements = select.querySelectorAll("option")
        return Array.from(optionElements)
          .map((option) => ({
            value: option.value,
            text: option.textContent.trim(),
          }))
          .filter(
            (opt) =>
              opt.value &&
              opt.value !== "" &&
              !opt.text.toLowerCase().includes("select") &&
              !opt.text.toLowerCase().includes("choose") &&
              !opt.text.toLowerCase().includes("see") &&
              opt.text !== "State" &&
              opt.text !== "District" &&
              opt.text !== "Branch",
          )
      }, selectSelector)

      return options
    } catch (error) {
      console.log(`❌ Error getting options from ${selectSelector}: ${error.message}`)
      return []
    }
  }

  async extractBankDetails() {
    try {
      await this.sleep(4000) // Increased from 3000

      const details = await this.page.evaluate(() => {
        // Try multiple container selectors to find the details
        const containerSelectors = [
          "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div",
          ".main table tbody tr td div",
          "table.main td.main div",
          "body table tbody tr td div",
        ]

        let container = null
        for (const selector of containerSelectors) {
          container = document.querySelector(selector)
          if (container) break
        }

        if (!container) {
          console.log("[v0] No container found for extraction")
          return null
        }

        // Get all text content and also try to find specific elements
        const allText = container.textContent || container.innerText || ""
        const innerHTML = container.innerHTML || ""

        // More comprehensive extraction patterns
        const extractField = (text, patterns) => {
          for (const pattern of patterns) {
            const match = text.match(pattern)
            if (match && match[1] && match[1].trim()) {
              return match[1].trim()
            }
          }
          return ""
        }

        // Enhanced patterns for better extraction
        const ifscPatterns = [
          /IFSC\s*Code[:\s]*([A-Z]{4}[0-9]{7}|[A-Z]{4}0[A-Z0-9]{6})/i,
          /IFSC[:\s]*([A-Z]{4}[0-9]{7}|[A-Z]{4}0[A-Z0-9]{6})/i,
          /Code[:\s]*([A-Z]{4}[0-9]{7}|[A-Z]{4}0[A-Z0-9]{6})/i,
        ]

        const micrPatterns = [/MICR\s*Code[:\s]*([0-9]{9})/i, /MICR[:\s]*([0-9]{9})/i, /([0-9]{9})/]

        const addressPatterns = [
          /Address[:\s]*([^\\n\\r]+?)(?=Contact|Phone|Mobile|State|District|Branch|IFSC|MICR|\\n|$)/i,
          /Address[:\s]*(.+?)(?=Contact|Phone|\\n)/i,
          /Address[:\s]*(.{10,200}?)(?=Contact|Phone|\\n)/i,
        ]

        const contactPatterns = [
          /Contact[:\s]*([^\\n\\r]+?)(?=IFSC|MICR|Address|\\n|$)/i,
          /Phone[:\s]*([^\\n\\r]+?)(?=IFSC|MICR|Address|\\n|$)/i,
          /Mobile[:\s]*([^\\n\\r]+?)(?=IFSC|MICR|Address|\\n|$)/i,
          /Tel[:\s]*([^\\n\\r]+?)(?=IFSC|MICR|Address|\\n|$)/i,
          /([0-9]{10,12})/,
          /(\+?[0-9\-\s$$$$]{10,15})/,
        ]

        const branchPatterns = [
          /Branch[:\s]*([^\\n\\r]+?)(?=Address|Contact|Phone|IFSC|MICR|\\n|$)/i,
          /Branch\s*Name[:\s]*([^\\n\\r]+?)(?=Address|Contact|\\n|$)/i,
          /Office[:\s]*([^\\n\\r]+?)(?=Address|Contact|\\n|$)/i,
        ]

        // Extract using patterns
        const ifscCode = extractField(allText, ifscPatterns)
        const micrCode = extractField(allText, micrPatterns)
        let address = extractField(allText, addressPatterns)
        let contact = extractField(allText, contactPatterns)
        let branchDetails = extractField(allText, branchPatterns)

        // Try alternative extraction methods if patterns fail
        if (!address || !contact || !branchDetails) {
          // Look for specific HTML elements
          const rows = container.querySelectorAll("tr, p, div")

          for (const row of rows) {
            const text = row.textContent || row.innerText || ""

            if (!address && (text.includes("Address") || text.includes("address"))) {
              const addressMatch = text.match(/(?:Address[:\s]*)?(.{20,200})/i)
              if (addressMatch && addressMatch[1]) {
                address = addressMatch[1].replace(/Address[:\s]*/i, "").trim()
              }
            }

            if (!contact && (text.includes("Contact") || text.includes("Phone") || text.includes("Mobile"))) {
              const contactMatch = text.match(/(?:Contact|Phone|Mobile)[:\s]*([^\\n\\r]{5,50})/i)
              if (contactMatch && contactMatch[1]) {
                contact = contactMatch[1].trim()
              }
            }

            if (!branchDetails && text.includes("Branch")) {
              const branchMatch = text.match(/(?:Branch[:\s]*)?([^\\n\\r]{5,100})/i)
              if (branchMatch && branchMatch[1]) {
                branchDetails = branchMatch[1].replace(/Branch[:\s]*/i, "").trim()
              }
            }
          }
        }

        // Clean up extracted data
        const cleanText = (text) => {
          if (!text) return ""
          return text
            .replace(/^[^:]*:\s*/, "") // Remove labels
            .replace(/\s+/g, " ") // Normalize whitespace
            .replace(/[\\n\\r\\t]/g, " ") // Remove line breaks
            .replace(/^\s*[-:]\s*/, "") // Remove leading dashes/colons
            .trim()
        }

        const data = {
          ifscCode: cleanText(ifscCode),
          micrCode: cleanText(micrCode),
          address: cleanText(address),
          contact: cleanText(contact),
          branchDetails: cleanText(branchDetails),
          rawText: allText.substring(0, 500), // Keep first 500 chars for debugging
          htmlContent: innerHTML.substring(0, 300), // Keep some HTML for debugging
        }

        // Validate extracted data
        if (!data.ifscCode || data.ifscCode.length < 11) {
          console.log("[v0] Invalid or missing IFSC code:", data.ifscCode)
        }

        console.log("[v0] Extracted data:", {
          ifsc: data.ifscCode,
          micr: data.micrCode,
          address: data.address ? data.address.substring(0, 50) + "..." : "Not found",
          contact: data.contact || "Not found",
          branch: data.branchDetails || "Not found",
        })

        return data
      })

      return details
    } catch (error) {
      console.log(`❌ Error extracting bank details: ${error.message}`)
      return null
    }
  }

  async navigateWithRetry(url, retries = 3) {
    // Added navigation helper with retry logic
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[v0] Navigation attempt ${attempt}/${retries} to ${url}`)
        await this.page.goto(url, {
          waitUntil: "domcontentloaded", // Changed from networkidle2 to domcontentloaded for faster loading
          timeout: 120000, // Explicit 2-minute timeout for navigation
        })
        await this.sleep(2000) // Wait for page to stabilize
        return true
      } catch (error) {
        console.log(`[v0] Navigation attempt ${attempt} failed: ${error.message}`)
        if (attempt === retries) {
          throw error
        }
        await this.sleep(3000) // Wait before retry
      }
    }
  }

  async scrapeAllBanks() {
    try {
      console.log("\n🏦 Starting comprehensive bank scraping for ALL 179 banks...\n")
      await this.navigateWithRetry(this.baseUrl) // Use new navigation method

      const selectors = {
        bank: "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(3) > div > select",
        state:
          "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(4) > div > select",
        district:
          "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(5) > div > select",
        branch:
          "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(6) > div > select",
      }

      // Get all banks
      const banks = await this.getAllOptionsWithValues(selectors.bank)
      console.log(`📊 Found ${banks.length} banks to process\n`)

      // Save bank list for reference
      await fs.writeFile(path.join(__dirname, "bank_list.json"), JSON.stringify(banks, null, 2))

      // Process ALL banks (no limits)
      for (let bankIndex = 0; bankIndex < banks.length; bankIndex++) {
        const bank = banks[bankIndex]
        console.log(`\n🏦 [${bankIndex + 1}/${banks.length}] Processing: ${bank.text}`)
        console.log(`Progress: ${((bankIndex / banks.length) * 100).toFixed(1)}%`)

        try {
          // Navigate to fresh page for each bank to avoid issues
          await this.navigateWithRetry(this.baseUrl) // Use new navigation method
          await this.sleep(1000)

          // Select bank
          const bankSelected = await this.selectOptionByValue(selectors.bank, bank.value)
          if (!bankSelected) {
            console.log(`❌ Failed to select bank: ${bank.text}`)
            continue
          }

          // Get states for this bank
          const states = await this.getAllOptionsWithValues(selectors.state)
          console.log(`  📍 Found ${states.length} states for ${bank.text}`)

          if (states.length === 0) {
            console.log(`  ⚠️ No states found for ${bank.text}`)
            continue
          }

          // Process ALL states for this bank
          for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
            const state = states[stateIndex]
            console.log(`    [${stateIndex + 1}/${states.length}] State: ${state.text}`)

            await this.navigateWithRetry(this.baseUrl) // Use new navigation method
            await this.sleep(1000)

            // Re-select bank for this state
            await this.selectOptionByValue(selectors.bank, bank.value)

            const stateSelected = await this.selectOptionByValue(selectors.state, state.value)
            if (!stateSelected) continue

            const districts = await this.getAllOptionsWithValues(selectors.district)

            console.log(`      🏙️ Found ${districts.length} districts`)

            if (districts.length === 0) {
              console.log(`      ⚠️ No districts found for ${state.text}`)
              continue
            }

            // Process ALL districts for this state
            for (let districtIndex = 0; districtIndex < districts.length; districtIndex++) {
              const district = districts[districtIndex]
              console.log(`        [${districtIndex + 1}/${districts.length}] District: ${district.text}`)

              await this.navigateWithRetry(this.baseUrl) // Use new navigation method
              await this.sleep(1000)

              // Re-select bank and state for this district
              await this.selectOptionByValue(selectors.bank, bank.value)
              await this.selectOptionByValue(selectors.state, state.value)

              const districtSelected = await this.selectOptionByValue(selectors.district, district.value)
              if (!districtSelected) continue

              // Get branches for this district
              const branches = await this.getAllOptionsWithValues(selectors.branch)
              console.log(`          🏢 Found ${branches.length} branches`)

              if (branches.length === 0) {
                console.log(`          ⚠️ No branches found for ${district.text}`)
                continue
              }

              for (let branchIndex = 0; branchIndex < branches.length; branchIndex++) {
                const branch = branches[branchIndex]
                console.log(`          [${branchIndex + 1}/${branches.length}] Processing: ${branch.text}`)

                try {
                  await this.navigateWithRetry(this.baseUrl) // Use new navigation method
                  await this.sleep(1000)

                  console.log(
                    `          🔄 Re-selecting: ${bank.text} -> ${state.text} -> ${district.text} -> ${branch.text}`,
                  )

                  // Select bank
                  await this.selectOptionByValue(selectors.bank, bank.value)

                  // Select state
                  await this.selectOptionByValue(selectors.state, state.value)

                  // Select district
                  await this.selectOptionByValue(selectors.district, district.value)

                  // Select branch
                  await this.selectOptionByValue(selectors.branch, branch.value)

                  // Extract bank details
                  const details = await this.extractBankDetails()

                  if (details && details.ifscCode) {
                    const record = {
                      bankName: bank.text,
                      state: state.text,
                      district: district.text,
                      branchName: branch.text,
                      ifscCode: details.ifscCode,
                      micrCode: details.micrCode || "Not Available",
                      address: details.address,
                      contact: details.contact,
                      branchDetails: details.branch,
                      scrapedAt: new Date().toISOString(),
                    }

                    this.data.push(record)
                    this.totalRecords++

                    console.log(`          ✅ [${this.totalRecords}] ${details.ifscCode} - ${branch.text}`)

                    // Save data every 50 records
                    if (this.totalRecords % 50 === 0) {
                      await this.saveData(`backup_${this.totalRecords}_records.json`)
                      console.log(`          💾 Backup saved: ${this.totalRecords} records`)
                    }
                  } else {
                    this.failedRecords++
                    console.log(`          ❌ Failed to extract data for ${branch.text}`)
                  }
                } catch (error) {
                  console.log(`          ❌ Error processing branch ${branch.text}: ${error.message}`)
                  this.failedRecords++
                }
              }
            }
          }
        } catch (error) {
          console.log(`❌ Error processing bank ${bank.text}: ${error.message}`)
        }

        // Save progress after each bank
        if (this.data.length > 0) {
          await this.saveData(`progress_bank_${bankIndex + 1}_of_${banks.length}.json`)
          console.log(`💾 Progress saved after ${bank.text}: ${this.data.length} total records`)
        }
      }

      console.log(`\n🎉 SCRAPING COMPLETED!`)
      console.log(`📊 Total Records Scraped: ${this.totalRecords}`)
      console.log(`❌ Failed Records: ${this.failedRecords}`)
      console.log(
        `📈 Success Rate: ${((this.totalRecords / (this.totalRecords + this.failedRecords)) * 100).toFixed(2)}%`,
      )

      return this.data
    } catch (error) {
      console.error("💥 Fatal error during scraping:", error)
      throw error
    }
  }

  async saveData(filename = "bank_ifsc_data.json") {
    try {
      const filePath = path.join(__dirname, filename)
      await fs.writeFile(filePath, JSON.stringify(this.data, null, 2))

      // Also save as CSV
      const csvFilename = filename.replace(".json", ".csv")
      await this.saveAsCSV(csvFilename)
    } catch (error) {
      console.error("❌ Error saving data:", error)
    }
  }

  async saveAsCSV(filename = "bank_ifsc_data.csv") {
    try {
      if (this.data.length === 0) return

      const headers = [
        "bankName",
        "state",
        "district",
        "branchName",
        "ifscCode",
        "micrCode",
        "address",
        "contact",
        "branchDetails",
        "scrapedAt",
      ]
      const csvContent = [
        headers.join(","),
        ...this.data.map((row) =>
          headers
            .map(
              (header) =>
                `"${(row[header] || "").toString().replace(/"/g, '""').replace(/\\n/g, " ").replace(/\\r/g, "")}"`,
            )
            .join(","),
        ),
      ].join("\n")

      const filePath = path.join(__dirname, filename)
      await fs.writeFile(filePath, csvContent)
    } catch (error) {
      console.error("❌ Error saving CSV:", error)
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close()
      console.log("🔒 Browser closed")
    }
  }
}

async function testScraper() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-gpu",
      "--no-first-run",
      "--disable-extensions",
      "--no-sandbox", // Added for better compatibility
      "--disable-setuid-sandbox", // Added for better compatibility
    ],
    protocolTimeout: 300000, // Increased timeout to 5 minutes
    timeout: 120000, // Increased timeout to 2 minutes
  })

  try {
    console.log("🚀 Initializing browser...")
    const page = await browser.newPage()

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    )

    try {
      await page.setRequestInterception(true)
      page.on("request", (req) => {
        const resourceType = req.resourceType()
        if (resourceType === "image") {
          req.abort()
        } else {
          req.continue()
        }
      })
    } catch (error) {
      console.log("⚠️ Request interception setup failed, continuing without it:", error.message)
    }

    console.log("✅ Browser initialized successfully")
    console.log("🧪 Testing with first 2 banks for validation...\n")

    await page.goto("https://bankifsccode.com/", {
      waitUntil: "domcontentloaded", // Changed from domcontentloaded to domcontentloaded for consistency
      timeout: 120000, // Increased timeout to 2 minutes
    })

    await page.waitForTimeout(4000) // Increased from 3000

    console.log("🔄 Resetting to home page...")
    const { selector: bankSelector, options: bankOptions } = await getBankOptions(page)

    console.log(`📊 Testing with first 2 of ${bankOptions.length} banks\n`)

    // Test with first 2 banks
    for (let i = 0; i < Math.min(2, bankOptions.length); i++) {
      const bank = bankOptions[i]
      console.log(`🏦 [${i + 1}/2] Testing: ${bank.text}`)

      try {
        await page.goto("https://bankifsccode.com/", {
          waitUntil: "domcontentloaded", // Changed from domcontentloaded for consistency
          timeout: 120000, // Increased timeout to 2 minutes
        })
        await page.waitForTimeout(2000) // Increased delay between operations

        await page.select(bankSelector, bank.value)

        console.log(`✅ Successfully selected bank: ${bank.text}`)
      } catch (error) {
        console.log(`❌ Failed to process bank ${bank.text}: ${error.message}`)
        continue
      }
    }
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`)
  } finally {
    await browser.close()
  }
}

async function testFewBanks() {
  const scraper = new BankIFSCScraper()

  try {
    await scraper.initialize()

    console.log("🧪 Testing with first 5 banks - PROCESSING ALL BRANCHES...\n")
    console.log("⏰ No time limits - will process until all branches are complete\n")

    // Modify the scraper to only process first 5 banks but ALL their branches
    const originalScrapeMethod = scraper.scrapeAllBanks
    scraper.scrapeAllBanks = async function () {
      await this.navigateWithRetry(this.baseUrl)

      const selectors = {
        bank: "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(3) > div > select",
        state:
          "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(4) > div > select",
        district:
          "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(5) > div > select",
        branch:
          "body > table.main > tbody > tr:nth-child(9) > td.main > table > tbody > tr > td:nth-child(1) > div > form:nth-child(6) > div > select",
      }

      const banks = await this.getAllOptionsWithValues(selectors.bank)
      console.log(`📊 Testing with first 5 of ${banks.length} banks - ALL BRANCHES WILL BE PROCESSED\n`)

      // Only process first 5 banks
      const banksToTest = banks.slice(0, 5)

      for (let bankIndex = 0; bankIndex < banksToTest.length; bankIndex++) {
        const bank = banksToTest[bankIndex]
        console.log(`\n🏦 [${bankIndex + 1}/5] Testing: ${bank.text}`)
        console.log(`⏰ Processing ALL branches for this bank - no limits applied`)

        await this.navigateWithRetry(this.baseUrl)

        const bankSelected = await this.selectOptionByValue(selectors.bank, bank.value)
        if (!bankSelected) continue

        const states = await this.getAllOptionsWithValues(selectors.state)
        console.log(`  📍 Found ${states.length} states - processing ALL`)

        for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
          const state = states[stateIndex]
          console.log(`    [${stateIndex + 1}/${states.length}] State: ${state.text}`)

          await this.navigateWithRetry(this.baseUrl)
          await this.sleep(1000)

          await this.selectOptionByValue(selectors.bank, bank.value)

          const stateSelected = await this.selectOptionByValue(selectors.state, state.value)
          if (!stateSelected) continue

          const districts = await this.getAllOptionsWithValues(selectors.district)
          console.log(`      🏙️ Found ${districts.length} districts - processing ALL`)

          for (let districtIndex = 0; districtIndex < districts.length; districtIndex++) {
            const district = districts[districtIndex]
            console.log(`        [${districtIndex + 1}/${districts.length}] District: ${district.text}`)

            await this.navigateWithRetry(this.baseUrl)
            await this.sleep(1000)

            await this.selectOptionByValue(selectors.bank, bank.value)
            await this.selectOptionByValue(selectors.state, state.value)

            const districtSelected = await this.selectOptionByValue(selectors.district, district.value)
            if (!districtSelected) continue

            const branches = await this.getAllOptionsWithValues(selectors.branch)
            console.log(`          🏢 Found ${branches.length} branches - processing ALL`)

            for (let branchIndex = 0; branchIndex < branches.length; branchIndex++) {
              const branch = branches[branchIndex]
              console.log(`          [${branchIndex + 1}/${branches.length}] Processing: ${branch.text}`)

              try {
                await this.navigateWithRetry(this.baseUrl)
                await this.sleep(1000)

                console.log(
                  `          🔄 Re-selecting: ${bank.text} -> ${state.text} -> ${district.text} -> ${branch.text}`,
                )

                await this.selectOptionByValue(selectors.bank, bank.value)
                await this.selectOptionByValue(selectors.state, state.value)
                await this.selectOptionByValue(selectors.district, district.value)
                await this.selectOptionByValue(selectors.branch, branch.value)

                const details = await this.extractBankDetails()

                if (details && details.ifscCode) {
                  const record = {
                    bankName: bank.text,
                    state: state.text,
                    district: district.text,
                    branchName: branch.text,
                    ifscCode: details.ifscCode,
                    micrCode: details.micrCode || "Not Available",
                    address: details.address,
                    contact: details.contact,
                    branchDetails: details.branchDetails,
                    scrapedAt: new Date().toISOString(),
                  }

                  this.data.push(record)
                  this.totalRecords++

                  console.log(`          ✅ [${this.totalRecords}] ${details.ifscCode} - ${branch.text}`)

                  if (this.totalRecords % 25 === 0) {
                    await this.saveData(`backup_${this.totalRecords}_records.json`)
                    console.log(`          💾 Backup saved: ${this.totalRecords} records`)
                  }
                } else {
                  this.failedRecords++
                  console.log(`          ❌ Failed to extract data for ${branch.text}`)
                }
              } catch (error) {
                console.log(`          ❌ Error processing branch ${branch.text}: ${error.message}`)
                this.failedRecords++
              }
            }
          }
        }

        if (this.data.length > 0) {
          await this.saveData(`test_progress_bank_${bankIndex + 1}_of_5.json`)
          console.log(`💾 Progress saved after ${bank.text}: ${this.data.length} total records`)
          console.log(
            `📊 Current success rate: ${((this.totalRecords / (this.totalRecords + this.failedRecords)) * 100).toFixed(2)}%`,
          )
        }
      }

      return this.data
    }

    await scraper.scrapeAllBanks()
    await scraper.saveData("test_5_banks_ALL_BRANCHES.json")

    console.log(`\n✅ Test completed! Scraped ${scraper.data.length} records from 5 banks.`)
    console.log(`📊 Total Records: ${scraper.totalRecords}`)
    console.log(`❌ Failed Records: ${scraper.failedRecords}`)
    console.log(
      `📈 Success Rate: ${((scraper.totalRecords / (this.totalRecords + scraper.failedRecords)) * 100).toFixed(2)}%`,
    )
    console.log("⏰ NO TIME LIMITS APPLIED - Completed when all data was extracted")
  } catch (error) {
    console.error("❌ Error:", error)
    // Emergency save for test mode too
    if (scraper.data.length > 0) {
      await scraper.saveData("test_emergency_save.json")
      console.log(`💾 Emergency save: ${scraper.data.length} records preserved`)
    }
  } finally {
    await scraper.close()
  }
}

// Main function for ALL banks
async function scrapeAllBanks() {
  const scraper = new BankIFSCScraper()

  try {
    await scraper.initialize()

    console.log("\n🚀 STARTING FULL SCRAPING OF ALL BANKS - NO TIME LIMITS")
    console.log("📊 This will continue until ALL banks, states, districts, and branches are processed")
    console.log("⏰ The scraper will only stop when COMPLETE - no time-based limits applied\n")

    const data = await scraper.scrapeAllBanks()

    await scraper.saveData("FINAL_ALL_BANKS_DATA.json")

    console.log("\n🎊 FINAL SUMMARY:")
    console.log(`📊 Total records scraped: ${data.length}`)
    console.log(`💾 Data saved as: FINAL_ALL_BANKS_DATA.json and .csv`)
    console.log("✅ SCRAPING COMPLETED - ALL DATA EXTRACTED")
  } catch (error) {
    console.error("💥 Fatal error:", error)
    // Auto-save on error to preserve data
    if (scraper.data.length > 0) {
      await scraper.saveData("ERROR_RECOVERY_DATA.json")
      console.log(`💾 Emergency save completed: ${scraper.data.length} records preserved`)
    }
  } finally {
    await scraper.close()
  }
}

// Run the scraper
if (require.main === module) {
  console.log("🚀 IFSC SCRAPER - NO TIME LIMITS MODE")
  console.log("📊 Choose your scraping mode:")
  console.log("1. Full scraping (ALL 179+ banks) - Uncomment scrapeAllBanks()")
  console.log("2. Test mode (5 banks, ALL branches) - Currently active")
  console.log("⏰ Both modes run until completion - NO TIME-BASED STOPPING\n")

  // Test mode - processes 5 banks with ALL their branches
  testFewBanks()

  // scrapeAllBanks();

  console.log("\n📝 TO RUN FULL SCRAPING:")
  console.log("1. Comment out testFewBanks()")
  console.log("2. Uncomment scrapeAllBanks()")
  console.log("3. The scraper will run until ALL data is extracted")
}

module.exports = BankIFSCScraper
