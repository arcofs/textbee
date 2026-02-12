
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function testApiKeyLogic() {
    console.log('--- Testing API Key Logic ---');

    // 1. Generation
    const apiKey = uuidv4();
    console.log(`Generated apiKey: ${apiKey} (Length: ${apiKey.length})`);

    const hashedApiKey = await bcrypt.hash(apiKey, 10);
    console.log(`Hashed apiKey: ${hashedApiKey}`);

    const storedApiKey = apiKey.substr(0, 17) + '*'.repeat(18);
    console.log(`Stored apiKey (masked): ${storedApiKey} (Length: ${storedApiKey.length})`);

    // Mock DB Document
    const mockDbApiKey = {
        apiKey: storedApiKey,
        hashedApiKey: hashedApiKey,
        revokedAt: null
    };

    // 2. Validation
    const incomingApiKey = apiKey; // Simulate client sending key
    console.log(`Incoming apiKey: ${incomingApiKey}`);

    // Regex construction
    const prefix = incomingApiKey.substr(0, 17);
    console.log(`Prefix extracted: ${prefix}`);
    const regex = new RegExp(`^${prefix}`, 'g');
    console.log(`Regex: ${regex}`);

    // Simulate DB Find
    const isMatch = regex.test(mockDbApiKey.apiKey);
    console.log(`DB Regex Match: ${isMatch}`);

    if (isMatch) {
        // Simulate Bcrypt Compare
        const isValid = bcrypt.compareSync(incomingApiKey, mockDbApiKey.hashedApiKey);
        console.log(`Bcrypt Compare: ${isValid}`);

        if (isValid) {
            console.log('SUCCESS: API Key Verified');
        } else {
            console.log('FAILURE: Bcrypt failed');
        }
    } else {
        console.log('FAILURE: Regex failed to find document');
    }
}

testApiKeyLogic();
