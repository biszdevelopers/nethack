console.log("Running tests...");

// import { testDeepSeek } from "./test.deepseek.ts";

// console.log("Running tests...");

// let result_testOAuth2;
// try {
//     result_testOAuth2 = await testOAuth2();
// } catch (error) {
//     console.error("Error during testOAuth2:", error);
//     result_testOAuth2 = false;
// }
// console.log("================================")
// console.log("testOAuth2: " + (result_testOAuth2 ? "PASSED" : "FAILED"));
// console.log("================================")

// const result_testDeepSeek = await testDeepSeek();
// console.log("================================")
// console.log("testDeepSeek: " + (result_testDeepSeek ? "PASSED" : "FAILED"));
// console.log("================================")

// import { testSearch } from "./test.search.ts"
// const result_testSearch = await testSearch();
// console.log("================================")
// console.log("testSearch: " + (result_testSearch ? "PASSED" : "FAILED"));
// console.log("================================")

const res = await fetch("http://localhost:24598/api/oauth2/token", {
    method: "POST",
    headers: {
        "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "test-authorization-code",
        client_id: "00000000-0000-0000-0000-000000000000",
        client_secret: "unused-test-fixture",
    }).toString(),
});

const json = await res.json();
const token = json.access_token;
console.log("Received token:", token);

const userinfo = await fetch("http://localhost:24598/api/oauth2/userinfo", {
    method: "GET",
    headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    },
});

console.log(await userinfo.json());
