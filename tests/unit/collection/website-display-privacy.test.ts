import { describe, expect, it } from "vitest";
import { sanitizeWebsiteDisplayDimension } from "@/collection/tracking/website-display-privacy";

const syntheticPan13 = ["700", "000", "000", "000", "3"].join("");
const syntheticPan16 = ["7000", "0000", "0000", "0005"].join("");
const syntheticPan19 = ["700", "0000", "0000", "0000", "000", "3"].join("");
const dottedPan16 = syntheticPan16.match(/.{1,4}/gu)!.join(".");
const invalidDottedPan16 = ["7000", "0000", "0000", "0100"].join(".");
const slashPan16 = syntheticPan16.match(/.{1,4}/gu)!.join("/");
const uninterruptedTwentyDigitIdentifier = `${syntheticPan19}5`;
const syntheticIpv4 = ["198", "51", "100", "42"].join(".");
const syntheticPhone = ["+1", " 202", "-555", "-0100"].join("");
const alternativeIpv4Host = "0xc633642a";

describe("Website display privacy", () => {
  it.each([
    {
      label: "malformed escape before an encoded email delimiter",
      value: "private-person%ZZ%40example.invalid",
    },
    {
      label: "malformed escape combined with double encoding",
      value: "private-person%25ZZ%2540example.invalid",
    },
    {
      label: "malformed escape after an encoded email delimiter",
      value: "private-person%40example.invalid%ZZ",
    },
    {
      label: "incomplete UTF-8 combined with an encoded canary",
      value: "private-person%E0%A4%A%40example.invalid",
    },
    {
      label: "invalid UTF-8 combined with an encoded canary",
      value: "private-person%C3%28%40example.invalid",
    },
    {
      label: "encoding deeper than the three-pass inspection bound",
      value: "private-person%25252540example.invalid",
    },
    {
      label: "an unsafe delimiter decoded on the third bounded pass",
      value: "private-person%252540example.invalid",
    },
    {
      label: "malformed encoding reached on the third pass",
      value: "campaign%2525ZZ",
    },
    {
      label: "a benign malformed literal percent",
      value: "spring%ZZsale",
    },
    {
      label: "malformed credential-like delimiters",
      value: "credential%ZZ%3Asynthetic",
    },
    { label: "an encoded fragment delimiter", value: "archive%23control" },
    { label: "an encoded query delimiter", value: "archive%3Fcontrol" },
    { label: "an encoded at-sign delimiter", value: "archive%40control" },
  ])("rejects $label without throwing", ({ value }) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 256)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe("");
  });

  it.each([
    { label: "the reported dotted candidate", value: dottedPan16 },
    { label: "a dotted candidate embedded between words", value: `launch-${dottedPan16}-archive` },
    { label: "mixed ASCII separators", value: "7000,0000_0000/0005" },
    { label: "additional punctuation separators", value: "7000;0000!0000=0005" },
    { label: "Unicode whitespace and dash separators", value: "7000\u00a00000\u20140000\u20090005" },
    { label: "an alphabetic Unicode symbol separator", value: "7000\u24d00000\u24d00000\u24d00005" },
    { label: "a supplementary Unicode symbol separator", value: "7000\u{1f130}0000\u{1f130}0000\u{1f130}0005" },
    { label: "a Unicode-table-gap BMP separator", value: "7000\u24270000\u24270000\u24270005" },
    { label: "a Unicode-table-gap supplementary separator", value: "7000\u{1f8d0}0000\u{1f8d0}0000\u{1f8d0}0005" },
    { label: "a contiguous candidate", value: syntheticPan16 },
    { label: "the 13-digit boundary", value: syntheticPan13 },
    { label: "the 19-digit boundary", value: syntheticPan19 },
    { label: "once-encoded separators", value: encodeURIComponent(slashPan16) },
    { label: "twice-encoded separators", value: encodeURIComponent(encodeURIComponent(slashPan16)) },
    {
      label: "three-times-encoded separators",
      value: encodeURIComponent(encodeURIComponent(encodeURIComponent(slashPan16))),
    },
    {
      label: "an invalid candidate before a later valid candidate",
      value: `first-${invalidDottedPan16}-then-${dottedPan16}`,
    },
    { label: "multiple candidates", value: `${dottedPan16}|${syntheticPan13}` },
    {
      label: "a long identifier followed by a separate valid candidate",
      value: `${uninterruptedTwentyDigitIdentifier}-${dottedPan16}`,
    },
    { label: "a valid candidate with short surrounding runs", value: `9-${dottedPan16}-8` },
    { label: "malformed encoding combined with a candidate", value: `%ZZ-${dottedPan16}` },
    {
      label: "an invalid IPv4 lookalike before a later valid address",
      value: `999.999.999.999x${syntheticIpv4}`,
    },
    {
      label: "an invalid phone lookalike before a later valid number",
      value: `0000000x${syntheticPhone}`,
    },
    {
      label: "an alternative IPv4 URL",
      value: `https://${alternativeIpv4Host}/`,
    },
    {
      label: "an encoded alternative IPv4 URL",
      value: encodeURIComponent(`https://${alternativeIpv4Host}/`),
    },
    {
      label: "an alternative IPv4 URL with a trailing dot",
      value: `https://${alternativeIpv4Host}./`,
    },
    {
      label: "an alternative IPv4 URL with a backslash path",
      value: `https://${alternativeIpv4Host}\\path`,
    },
    {
      label: "an alternative IPv4 URL with an elided authority delimiter",
      value: `https:${alternativeIpv4Host}`,
    },
    {
      label: "an alternative IPv4 URL with extra authority slashes",
      value: `https:///${alternativeIpv4Host}`,
    },
    {
      label: "an alternative IPv4 FTP URL",
      value: `ftp:${alternativeIpv4Host}`,
    },
    {
      label: "an alternative IPv4 file URL authority",
      value: `file://${alternativeIpv4Host}/`,
    },
    {
      label: "an alternative IPv4 URL after non-breaking space",
      value: `\u00a0https://${alternativeIpv4Host}/`,
    },
    {
      label: "an alternative IPv4 URL after a byte-order mark",
      value: `\ufeffhttps://${alternativeIpv4Host}/`,
    },
    {
      label: "an alternative IPv4 URL before non-breaking space",
      value: `https://${alternativeIpv4Host}/\u00a0`,
    },
    { label: "an assigned scheme-relative alternative IPv4 URL", value: `redirect=//${alternativeIpv4Host}/path` },
    { label: "a parenthesized scheme-relative alternative IPv4 URL", value: `prefix (//${alternativeIpv4Host}/path)` },
    { label: "a pipe-delimited scheme-relative alternative IPv4 URL", value: `prefix|//${alternativeIpv4Host}/path` },
    { label: "an email before a trailing dot", value: "privacy@fixture.invalid." },
    { label: "an email before a trailing hyphen", value: "privacy@fixture.invalid-" },
    { label: "an email before a short extra label", value: "privacy@fixture.invalid.x" },
    {
      label: "an encoded email before a trailing dot",
      value: encodeURIComponent("privacy@fixture.invalid."),
    },
    { label: "an EAI address with a trailing combining mark", value: "用户@例子.中国\u0301" },
    { label: "a decomposed EAI local part", value: "jose\u0301@example.invalid" },
    { label: "a fullwidth email", value: "ｐｒｉｖａｃｙ＠ｆｉｘｔｕｒｅ．ｉｎｖａｌｉｄ" },
    { label: "a fullwidth street address", value: "１２３ Ｍａｉｎ Ｓｔｒｅｅｔ" },
    { label: "a zero-width-separated street address", value: "123\u200bMain\u200bStreet" },
    { label: "a fullwidth credential", value: "Ｂｅａｒｅｒ ａｂｃｄｅｆｇｈ" },
    { label: "a zero-width-separated bearer credential", value: "Bearer\u200babcdefgh" },
    { label: "a zero-width-separated basic credential", value: "Basic\u200bdXNlcjpwYXNz" },
    { label: "a ZWNJ-separated street address", value: "123\u200cMain\u200cStreet" },
    { label: "a ZWJ-separated bearer credential", value: "Bearer\u200dabcdefgh" },
    { label: "an LRM-separated phone", value: "202\u200e555\u200e0100" },
    { label: "an RLO-separated payment candidate", value: "7000\u202e0000\u202e0000\u202e0005" },
    { label: "an Arabic-mark-separated basic credential", value: "Basic\u061cdXNlcjpwYXNz" },
    { label: "a braille-blank-separated street address", value: "123\u2800Main\u2800Street" },
    { label: "a braille-blank-separated bearer credential", value: "Bearer\u2800abcdefgh" },
    { label: "a braille-blank-separated phone", value: "202\u2800555\u28000100" },
    { label: "a fullwidth payment candidate", value: "７０００．００００．００００．０００５" },
    { label: "an Arabic-Indic payment candidate", value: "٧٠٠٠.٠٠٠٠.٠٠٠٠.٠٠٠٥" },
    { label: "a Devanagari payment candidate", value: "७०००.००००.००००.०००५" },
    { label: "a combining-mark-separated payment candidate", value: "7000\u0301.0000\u0301.0000\u0301.0005" },
    { label: "an ignored-character payment candidate", value: "7000\u200b.0000.0000.0005" },
    { label: "a fullwidth IPv4 address", value: "１９８．５１．１００．４２" },
    { label: "an Arabic-Indic phone number", value: "٢٠٢ ٥٥٥ ٠١٠٠" },
    { label: "a slash-formatted UK phone number", value: "44/20/7946/0958" },
    { label: "a slash-formatted German phone number", value: "49/30/1234/5678" },
    { label: "a slash-formatted national phone number", value: "030/123/45678" },
    { label: "a contiguous Kazakhstan phone number", value: "74951234567" },
    { label: "a contiguous Moroccan phone number", value: "212612345678" },
    { label: "a contiguous Kenyan phone number", value: "254712345678" },
    { label: "a contiguous Israeli phone number", value: "972501234567" },
    { label: "a dotted international phone number", value: "44.20.7946.0958" },
    { label: "a dotted national phone number", value: "020.7946.0958" },
    { label: "a two-run slash-formatted national phone number", value: "020/79460958" },
    { label: "a two-run hyphen-formatted national phone number", value: "020-79460958" },
    { label: "an encoded two-run national phone number", value: "020%2F79460958" },
    { label: "a twice-encoded two-run national phone number", value: "020%252F79460958" },
    { label: "a Unicode-dash phone number", value: "202–555–0100" },
    { label: "a symbol-separated phone number", value: "202•555•0100" },
    { label: "an underscore-separated phone number", value: "202_555_0100" },
    { label: "a combining-mark-obfuscated phone number", value: "202\u0301 555\u0301 0100" },
    { label: "a combining-mark-obfuscated international phone number", value: "44\u0301/20\u0301/7946\u0301/0958" },
    { label: "a NANP area followed by a compressed local number", value: "202-5550100" },
    { label: "a compressed NANP prefix followed by a subscriber number", value: "202555-0100" },
    { label: "a spaced NANP area followed by a compressed local number", value: "202 5550100" },
    { label: "a parenthesized NANP area followed by a compressed local number", value: "(202)5550100" },
    { label: "a country-prefixed compressed NANP number", value: "1-202-5550100" },
    {
      label: "a formatted phone prefix followed by non-Luhn numeric padding",
      value: "202ⓐ555ⓐ0100ⓐ000100",
    },
    { label: "a C1 control", value: `archive${String.fromCharCode(0x85)}control` },
    { label: "a punctuation-terminated credential", value: "Bearer abcdefgh_" },
    { label: "a short Bearer credential", value: "Bearer abc123" },
    { label: "a one-character Bearer credential", value: "Bearer x" },
    { label: "a short unpadded Basic credential", value: "Basic dTpw" },
    { label: "another short unpadded Basic credential", value: "Basic YTpi" },
    { label: "a six-character unpadded Basic credential", value: "Basic YTpiYQ" },
    { label: "a two-character unpadded Basic credential", value: "Basic Og" },
    { label: "a short padded Basic credential", value: "Basic Og==" },
    { label: "an encoded short Basic credential", value: encodeURIComponent("Basic dTpw") },
    { label: "a whitespace-delimited token", value: "launch token=synthetic_value_12345678" },
    { label: "a punctuation-delimited password", value: "launch(password=synthetic_value_12345678)" },
    { label: "a spaced API key name", value: "launch api key:synthetic_value_12345678" },
    { label: "whitespace before a token delimiter", value: "launch token = synthetic_value_12345678" },
    { label: "whitespace before a password delimiter", value: "launch password : synthetic_value_12345678" },
    { label: "a quoted JSON token key", value: '{"token":"synthetic_value_12345678"}' },
    { label: "a camel-case access token", value: "accessToken=synthetic_value_12345678" },
    { label: "a refresh token", value: "refresh_token=synthetic_value_12345678" },
    { label: "a client secret", value: "client_secret=synthetic_value_12345678" },
    { label: "a payment token", value: "payment token=synthetic_value_12345678" },
    { label: "an encoded embedded credential", value: encodeURIComponent("launch access key=synthetic_value_12345678") },
    { label: "a synthetic GitHub credential shape", value: `ghp_${"A".repeat(30)}` },
    { label: "a synthetic Shopify credential shape", value: `shpat_${"A".repeat(20)}` },
    { label: "a synthetic Slack credential shape", value: `xoxb-${"1".repeat(16)}` },
    { label: "a synthetic AWS access-key shape", value: `AKIA${"A".repeat(16)}` },
    { label: "HTTP URL userinfo", value: "https://alice:syntheticpass@localhost/path" },
    { label: "FTP URL userinfo", value: "ftp://alice:syntheticpass@localhost/path" },
    { label: "custom-scheme URL userinfo", value: "fixture://alice:syntheticpass@localhost/path" },
    { label: "embedded URL userinfo", value: "prefix https://alice:syntheticpass@localhost/path" },
    { label: "scheme-relative URL userinfo", value: "//alice:syntheticpass@localhost/path" },
    { label: "backslash URL userinfo", value: "\\\\alice:syntheticpass@localhost\\path" },
    {
      label: "punctuation-wrapped scheme-relative URL userinfo",
      value: "prefix (//alice:syntheticpass@localhost/path)",
    },
    { label: "assigned scheme-relative URL userinfo", value: "redirect=//alice:syntheticpass@localhost/path" },
    { label: "comma-delimited scheme-relative URL userinfo", value: "prefix,//alice:syntheticpass@localhost/path" },
    { label: "JSON scheme-relative URL userinfo", value: '{"redirect":"//alice:syntheticpass@localhost/path"}' },
    { label: "angle-wrapped scheme-relative URL userinfo", value: "prefix<//alice:syntheticpass@localhost/path>" },
    { label: "pipe-delimited scheme-relative URL userinfo", value: "prefix|//alice:syntheticpass@localhost/path" },
    { label: "ampersand-delimited scheme-relative URL userinfo", value: "prefix&//alice:syntheticpass@localhost/path" },
    { label: "greater-than-delimited scheme-relative URL userinfo", value: "prefix>//alice:syntheticpass@localhost/path" },
    { label: "plus-delimited scheme-relative URL userinfo", value: "prefix+//alice:syntheticpass@localhost/path" },
    { label: "parenthesis-delimited scheme-relative URL userinfo", value: "prefix)//alice:syntheticpass@localhost/path" },
    { label: "bracket-delimited scheme-relative URL userinfo", value: "prefix]//alice:syntheticpass@localhost/path" },
    { label: "brace-delimited scheme-relative URL userinfo", value: "prefix}//alice:syntheticpass@localhost/path" },
    { label: "Unicode-punctuation-delimited scheme-relative URL userinfo", value: "prefix—//alice:syntheticpass@localhost/path" },
    { label: "a first-name field", value: "first_name=Alice" },
    { label: "a camel-case last-name field", value: "lastName=Smith" },
    { label: "a full-name field", value: "full name:Alice Smith" },
    { label: "a customer-name field", value: "customer_name=Alice" },
    { label: "an alphanumeric house number", value: "42A Fixture Road" },
    { label: "a common suffix street address", value: "1 Fixture Place" },
    { label: "a common suffix terrace address", value: "10 Fixture Terrace" },
    { label: "a canonical email key", value: "email=synthetic" },
    { label: "a canonical phone key", value: "mobile_number=synthetic" },
    { label: "a canonical address key", value: "shipping_address=synthetic" },
    { label: "a canonical payment key", value: "card_number=synthetic" },
    { label: "a canonical CVV key", value: "cvv=synthetic" },
    { label: "a canonical IP key", value: "client_ip=synthetic" },
    { label: "a canonical source identifier key", value: "source_id=synthetic" },
    { label: "a canonical event identifier key", value: "event_id=synthetic" },
    { label: "a canonical session identifier key", value: "session_id=synthetic" },
    { label: "a canonical anonymous identifier key", value: "anonymous_id=synthetic" },
    { label: "a canonical user identifier key", value: "user_id=synthetic" },
    { label: "a public tracking key field", value: "public_tracking_key=synthetic" },
    { label: "a user-agent field", value: "user_agent=synthetic" },
    { label: "a punctuation-obfuscated email key", value: "e.m.a.i.l=synthetic" },
    { label: "a qualified punctuation-obfuscated email key", value: "e+m+a+i+l_hash=synthetic" },
    { label: "a quoted slash-obfuscated email key", value: "\"e/m/a/i/l\"=synthetic" },
    { label: "a qualified split source identifier key", value: "s+o+u+r+c+e+i+d_value=synthetic" },
    { label: "a qualified split user-agent key", value: "u+s+e+r+a+g+e+n+t_string=synthetic" },
    { label: "a camel-case qualified source identifier key", value: "sourceIdValue=synthetic" },
    { label: "a dotted qualified source identifier key", value: "source.i.d_value=synthetic" },
    { label: "a concatenated email qualifier", value: "customeremailhash=synthetic" },
    { label: "a concatenated phone qualifier", value: "phonenumber=synthetic" },
    { label: "a concatenated address qualifier", value: "shippingaddressline1=synthetic" },
    { label: "a concatenated payment qualifier", value: "cardnumberlast4=synthetic" },
    { label: "a concatenated password qualifier", value: "passwordhash=synthetic" },
    { label: "a concatenated name qualifier", value: "customernamenormalized=synthetic" },
    { label: "a concatenated source identifier qualifier", value: "sourceidvalue=synthetic" },
    { label: "a concatenated tracking key qualifier", value: "trackingkeyvalue=synthetic" },
    { label: "a concatenated user-agent qualifier", value: "useragentstring=synthetic" },
    { label: "a numeric email qualifier", value: "email1=synthetic" },
    {
      label: "a sensitive key padded with supplementary scalars",
      value: `email${"😀".repeat(60)}label=synthetic`,
    },
    { label: "a numeric-leading email key", value: "123email=synthetic" },
    { label: "a bounded long-prefix email key", value: `${"x".repeat(110)}email=synthetic` },
    { label: "an email key exactly inside the 120-code-point window", value: `${"x".repeat(115)}email=synthetic` },
    { label: "an email key behind more than 120 padding code points", value: `email${"x".repeat(121)}=synthetic` },
    { label: "a repeated-separator email key", value: "email___address=synthetic" },
    { label: "an email before a safe access-token terminal form", value: "emailAccessTokenizer=archive" },
    { label: "a token before a safe access-token terminal form", value: "tokenAccessTokenizer=archive" },
    { label: "a repeated access token before a safe terminal form", value: "accessTokenAccessTokenizer=archive" },
    { label: "a safe token word before a safe source-id terminal form", value: "accessTokenizerSourceIdentifier=archive" },
    { label: "a safe token word with a non-safe terminal qualifier", value: "accessTokenizerHash=archive" },
    { label: "a safe source-id word with a non-safe terminal qualifier", value: "sourceIdentifierValue=archive" },
    { label: "an API-key prefix with a non-safe terminal qualifier", value: "apiKeyNotebook=archive" },
    { label: "a punctuation-split access-token terminal form", value: "access-token-izer=archive" },
    { label: "a punctuation-split API-key terminal form", value: "api-key-note=archive" },
    { label: "a punctuation-split source-id terminal form", value: "source-id-entifier=archive" },
    { label: "a punctuation-split event-id terminal form", value: "event-id-ea=archive" },
    { label: "a punctuation-split user-agent terminal form", value: "user-agent-ive=archive" },
    { label: "an authorization-header key", value: "authorization_header=synthetic" },
    { label: "a later pipe-delimited email key", value: "safe=x|email=synthetic" },
    { label: "a later exclamation-delimited phone key", value: "safe=x!phone=synthetic" },
    { label: "a later brace-delimited source identifier key", value: "safe=x}source_id=synthetic" },
    { label: "a later angle-delimited user-agent key", value: "safe=x>user_agent=synthetic" },
    { label: "a later plus-delimited tracking key", value: "safe=x+tracking_key=synthetic" },
    { label: "slash-elided HTTPS userinfo", value: "https:alice:syntheticpass@localhost" },
    { label: "single-slash HTTP userinfo", value: "http:/alice:syntheticpass@localhost" },
    { label: "single-backslash HTTPS userinfo", value: "https:\\alice:syntheticpass@localhost" },
    { label: "slash-elided FTP userinfo", value: "ftp:alice:syntheticpass@localhost" },
    { label: "slash-elided WebSocket userinfo", value: "ws:alice:syntheticpass@localhost" },
    {
      label: "encoded URL userinfo",
      value: encodeURIComponent("fixture://alice:syntheticpass@localhost/path"),
    },
    {
      label: "an encoded fullwidth email",
      value: encodeURIComponent("ｐｒｉｖａｃｙ＠ｆｉｘｔｕｒｅ．ｉｎｖａｌｉｄ"),
    },
    { label: "an email behind a fullwidth percent escape", value: "private-person％40example.invalid" },
    { label: "an email behind fullwidth percent digits", value: "private-person％４０example.invalid" },
    { label: "a credential delimiter behind a fullwidth percent escape", value: "credential％3Asynthetic" },
    {
      label: "a combining-mark-separated payment candidate with numeric padding",
      value: "7000\u03010000\u03010000\u03010005\u03011234",
    },
    {
      label: "a zero-width-separated payment candidate with numeric padding",
      value: "7000\u200b0000\u200b0000\u200b0005\u200b1234",
    },
    { label: "a combining-mark-obfuscated IPv4 address", value: "198\u0301.51\u0301.100\u0301.42" },
    {
      label: "a combining-mark-obfuscated numeric authority",
      value: "https://0x7f\u0301.0\u0301.0\u0301.1/",
    },
    { label: "a non-ASCII street name", value: "123 Máin Street" },
    { label: "a combining-mark-obfuscated street address", value: "42A Fixtu\u0301re Road" },
    { label: "a comma-separated street address", value: "123, Main Street" },
    { label: "a period-separated street address", value: "123. Main Street" },
    { label: "a semicolon-separated street address", value: "123; Main Street" },
    { label: "a colon-separated street address", value: "123: Main Street" },
    { label: "a slash-separated street address", value: "123/Main Street" },
    { label: "a slash-separated unit street address", value: "123/B Main Street" },
    { label: "a punctuation-only slash street address", value: "123/Main/Street" },
    { label: "a punctuation-only backslash street address", value: "123\\Main\\Street" },
    { label: "a punctuation-only colon street address", value: "123:Main:Street" },
    { label: "a punctuation-only period street address", value: "123.Main.Street" },
    { label: "a punctuation-only comma street address", value: "123,Main,Street" },
    { label: "a punctuation-only semicolon street address", value: "123;Main;Street" },
    { label: "a dotted PO box with a slash before the box number", value: "P.O.Box/123" },
    { label: "a slash-only PO box", value: "P/O/Box/123" },
    { label: "a colon-only PO box", value: "P:O:Box:123" },
    { label: "a comma-only PO box", value: "P,O,Box,123" },
    { label: "a punctuation-only long-form PO box", value: "Post.Office.Box/123" },
    { label: "malformed numeric-scheme URL userinfo", value: "1://alice:syntheticpass@localhost/path" },
    { label: "malformed punctuation-scheme URL userinfo", value: "-://alice:syntheticpass@localhost/path" },
    { label: "malformed numeric-scheme numeric host", value: "1://0xc633642a/path" },
  ])("rejects $label without throwing", ({ value }) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 256)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe("");
  });

  it.each([
    { label: "a fully safe UTM", value: "spring-sale_2026" },
    { label: "a bounded encoded non-PII value", value: "spring%20sale" },
    { label: "a bounded encoded Unicode control", value: "caf%C3%A9" },
    { label: "a safe value decoded on exactly three passes", value: "spring%252520sale" },
    { label: "the Unknown sentinel", value: "Unknown" },
    { label: "the dotted shape with an invalid check digit", value: invalidDottedPan16 },
    { label: "an ordinary dotted build value", value: "release.2026.08.02.build.14" },
    { label: "a 12-digit lookalike", value: "7000.0000.0003" },
    { label: "an uninterrupted 20-digit identifier", value: uninterruptedTwentyDigitIdentifier },
    {
      label: "a long identifier followed only by a short numeric fragment",
      value: `${uninterruptedTwentyDigitIdentifier}-12`,
    },
    { label: "numeric fragments separated by letters", value: "700000A000000B005" },
    { label: "an email lookalike before underscore", value: "privacy@fixture.invalid_" },
    { label: "a localized year", value: "summer-٢٠٢٦" },
    { label: "a year and release identifier", value: "2026-1234567" },
    { label: "a two-run numeric release path", value: "2026/12345678" },
    { label: "an invalid NANP area control", value: "102-5550100" },
    { label: "an invalid NANP exchange control", value: "202-1550100" },
    { label: "a safe numeric campaign", value: "campaign-123.4-release" },
    { label: "a safe numeric path label", value: "archive/123/version" },
    { label: "a post-office campaign control", value: "post-office-launch" },
    { label: "a postal campaign control", value: "postal-campaign" },
    { label: "a benign fullwidth percent", value: "save％off" },
    { label: "a benign fullwidth label", value: "ＳＰＲＩＮＧ" },
    { label: "a credential-key prefix", value: "tokenizer=archive" },
    { label: "a high-delimiter label without a sensitive family", value: `archive${"=".repeat(65)}control` },
    { label: "a Basic plan label", value: "Basic plan" },
    { label: "a Basic tier label", value: "Basic tier" },
    { label: "a Basic free label", value: "Basic free" },
    { label: "a hyphenated bearer word", value: "bearer-bond" },
    { label: "a hyphenated basic word", value: "basic-plan" },
    { label: "a first-name campaign label", value: "first-name-campaign" },
    { label: "a customer-name campaign label", value: "customer-name-story" },
    { label: "an API key word prefix", value: "api-keynote=archive" },
    { label: "an access-token word prefix", value: "accessTokenizer=archive" },
    { label: "a prefixed access-token word", value: "prefixAccessTokenizer=archive" },
    { label: "a source-identifier prefix", value: "source-identifier=archive" },
    { label: "an event-idea prefix", value: "event-idea=archive" },
    { label: "a session-idea prefix", value: "session-idea=archive" },
    { label: "an anonymous-idea prefix", value: "anonymous-idea=archive" },
    { label: "a user-idea prefix", value: "user-idea=archive" },
    { label: "a tracking-keynote prefix", value: "tracking-keynote=archive" },
    { label: "a user-agentive prefix", value: "user-agentive=archive" },
    { label: "an ignored character in a benign label", value: "launch\u200barchive" },
    { label: "a benign emoji ZWJ label", value: "launch-👩‍💻-archive" },
    { label: "a benign RTL-format label", value: "campaign\u202earchive" },
    { label: "a benign braille-blank label", value: "campaign\u2800archive" },
    { label: "a social handle", value: "social@handle" },
    { label: "an at-sign outside an authority", value: "archive/social@handle" },
    { label: "an at-sign in a URL path", value: "https://fixture.invalid/archive/social@handle" },
    {
      label: "an at-sign after repeated URL-path slashes",
      value: "https://fixture.invalid/archive//social@handle",
    },
    {
      label: "an at-sign after repeated relative-path slashes",
      value: "/collections/archive//social@handle",
    },
    { label: "an opaque custom-scheme handle", value: "fixture:alice@localhost" },
    { label: "a bare-colon pseudo-scheme host", value: "://example.invalid/path" },
    { label: "a numeric pseudo-scheme host", value: "0://example.invalid/path" },
    { label: "a plus pseudo-scheme host", value: "+://example.invalid/path" },
    { label: "an underscore pseudo-scheme host", value: "_://example.invalid/path" },
    { label: "a dotted-hyphen pseudo-scheme host", value: ".-://example.invalid/path" },
    { label: "a numeric host under a non-special scheme", value: `fixture://${alternativeIpv4Host}/` },
    { label: "a file URL with a numeric path instead of a host", value: `file:///${alternativeIpv4Host}` },
  ])("preserves $label without changing its representation", ({ value }) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 256)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe(value);
  });

  it.each([
    alternativeIpv4Host,
    "2130706433",
    "0177.0.0.1",
    "0x7f.0.0.1",
  ])("rejects the alternative IPv4 host %s", (value) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "referrer_host", 253)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "referrer_host", 253)).toBe("");
  });

  it("preserves a domain with an ordinary numeric label", () => {
    expect(sanitizeWebsiteDisplayDimension("123.editorial.example.invalid", "referrer_host", 253))
      .toBe("123.editorial.example.invalid");
  });

  it("trims the ECMAScript boundary whitespace set before returning a safe value", () => {
    expect(sanitizeWebsiteDisplayDimension("\u00a0spring-sale\ufeff", "utm", 256))
      .toBe("spring-sale");
  });

  it("preserves a landing path with repeated slashes away from the authority boundary", () => {
    expect(sanitizeWebsiteDisplayDimension("/collections/2026//123/", "landing_path", 500))
      .toBe("/collections/2026//123/");
  });

  it("inspects a late payment window after the maximum bounded NFKC digit expansion", () => {
    const value = `https://editorial.example.invalid/${"\u2152".repeat(800)}７０００．００００．００００．０００５`;
    expect(value.length).toBeLessThanOrEqual(1200);
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 1200)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 1200)).toBe("");
  });
});
