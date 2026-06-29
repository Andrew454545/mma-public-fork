const COUNTRY_CODE_TO_NAME: Record<string, string> = {
	AD: "Andorra", AE: "United Arab Emirates", AF: "Afghanistan", AG: "Antigua and Barbuda", AI: "Anguilla",
	AL: "Albania", AM: "Armenia", AO: "Angola", AQ: "Antarctica", AR: "Argentina", AS: "American Samoa",
	AT: "Austria", AU: "Australia", AW: "Aruba", AX: "Aland Islands", AZ: "Azerbaijan", BA: "Bosnia and Herzegovina",
	BB: "Barbados", BD: "Bangladesh", BE: "Belgium", BF: "Burkina Faso", BG: "Bulgaria", BH: "Bahrain",
	BI: "Burundi", BJ: "Benin", BL: "Saint Barthelemy", BM: "Bermuda", BN: "Brunei", BO: "Bolivia",
	BQ: "Caribbean Netherlands", BR: "Brazil", BS: "Bahamas", BT: "Bhutan", BV: "Bouvet Island", BW: "Botswana",
	BY: "Belarus", BZ: "Belize", CA: "Canada", CC: "Cocos (Keeling) Islands", CD: "DR Congo", CF: "Central African Republic",
	CG: "Republic of the Congo", CH: "Switzerland", CI: "Cote d'Ivoire", CK: "Cook Islands", CL: "Chile",
	CM: "Cameroon", CN: "China", CO: "Colombia", CR: "Costa Rica", CU: "Cuba", CV: "Cape Verde", CW: "Curacao",
	CX: "Christmas Island", CY: "Cyprus", CZ: "Czech Republic", DE: "Germany", DJ: "Djibouti", DK: "Denmark",
	DM: "Dominica", DO: "Dominican Republic", DZ: "Algeria", EC: "Ecuador", EE: "Estonia", EG: "Egypt",
	EH: "Western Sahara", ER: "Eritrea", ES: "Spain", ET: "Ethiopia", FI: "Finland", FJ: "Fiji",
	FK: "Falkland Islands", FM: "Micronesia", FO: "Faroe Islands", FR: "France", GA: "Gabon", GB: "United Kingdom",
	GD: "Grenada", GE: "Georgia", GF: "French Guiana", GG: "Guernsey", GH: "Ghana", GI: "Gibraltar",
	GL: "Greenland", GM: "Gambia", GN: "Guinea", GP: "Guadeloupe", GQ: "Equatorial Guinea", GR: "Greece",
	GS: "South Georgia and the South Sandwich Islands", GT: "Guatemala", GU: "Guam", GW: "Guinea-Bissau",
	GY: "Guyana", HK: "Hong Kong", HM: "Heard Island and McDonald Islands", HN: "Honduras", HR: "Croatia",
	HT: "Haiti", HU: "Hungary", ID: "Indonesia", IE: "Ireland", IL: "Israel", IM: "Isle of Man",
	IN: "India", IO: "British Indian Ocean Territory", IQ: "Iraq", IR: "Iran", IS: "Iceland", IT: "Italy",
	JE: "Jersey", JM: "Jamaica", JO: "Jordan", JP: "Japan", KE: "Kenya", KG: "Kyrgyzstan", KH: "Cambodia",
	KI: "Kiribati", KM: "Comoros", KN: "Saint Kitts and Nevis", KP: "North Korea", KR: "South Korea",
	KW: "Kuwait", KY: "Cayman Islands", KZ: "Kazakhstan", LA: "Laos", LB: "Lebanon", LC: "Saint Lucia",
	LI: "Liechtenstein", LK: "Sri Lanka", LR: "Liberia", LS: "Lesotho", LT: "Lithuania", LU: "Luxembourg",
	LV: "Latvia", LY: "Libya", MA: "Morocco", MC: "Monaco", MD: "Moldova", ME: "Montenegro", MF: "Saint Martin",
	MG: "Madagascar", MH: "Marshall Islands", MK: "North Macedonia", ML: "Mali", MM: "Myanmar", MN: "Mongolia",
	MO: "Macau", MP: "Northern Mariana Islands", MQ: "Martinique", MR: "Mauritania", MS: "Montserrat",
	MT: "Malta", MU: "Mauritius", MV: "Maldives", MW: "Malawi", MX: "Mexico", MY: "Malaysia", MZ: "Mozambique",
	NA: "Namibia", NC: "New Caledonia", NE: "Niger", NF: "Norfolk Island", NG: "Nigeria", NI: "Nicaragua",
	NL: "Netherlands", NO: "Norway", NP: "Nepal", NR: "Nauru", NU: "Niue", NZ: "New Zealand", OM: "Oman",
	PA: "Panama", PE: "Peru", PF: "French Polynesia", PG: "Papua New Guinea", PH: "Philippines", PK: "Pakistan",
	PL: "Poland", PM: "Saint Pierre and Miquelon", PN: "Pitcairn Islands", PR: "Puerto Rico", PS: "Palestine",
	PT: "Portugal", PW: "Palau", PY: "Paraguay", QA: "Qatar", RE: "Reunion", RO: "Romania", RS: "Serbia",
	RU: "Russia", RW: "Rwanda", SA: "Saudi Arabia", SB: "Solomon Islands", SC: "Seychelles", SD: "Sudan",
	SE: "Sweden", SG: "Singapore", SH: "Saint Helena, Ascension and Tristan da Cunha", SI: "Slovenia",
	SJ: "Svalbard and Jan Mayen", SK: "Slovakia", SL: "Sierra Leone", SM: "San Marino", SN: "Senegal",
	SO: "Somalia", SR: "Suriname", SS: "South Sudan", ST: "Sao Tome and Principe", SV: "El Salvador",
	SX: "Sint Maarten", SY: "Syria", SZ: "Eswatini", TC: "Turks and Caicos Islands", TD: "Chad", TF: "French Southern and Antarctic Lands",
	TG: "Togo", TH: "Thailand", TJ: "Tajikistan", TK: "Tokelau", TL: "Timor-Leste", TM: "Turkmenistan",
	TN: "Tunisia", TO: "Tonga", TR: "Turkey", TT: "Trinidad and Tobago", TV: "Tuvalu", TW: "Taiwan",
	TZ: "Tanzania", UA: "Ukraine", UG: "Uganda", UM: "United States Minor Outlying Islands", US: "USA",
	UY: "Uruguay", UZ: "Uzbekistan", VA: "Vatican City", VC: "Saint Vincent and the Grenadines", VE: "Venezuela",
	VG: "British Virgin Islands", VI: "United States Virgin Islands", VN: "Vietnam", VU: "Vanuatu",
	WF: "Wallis and Futuna", WS: "Samoa", YE: "Yemen", YT: "Mayotte", ZA: "South Africa", ZM: "Zambia", ZW: "Zimbabwe",
};

const TERRITORY_TO_COUNTRY: Record<string, string> = {
	PR: "US", GU: "US", VI: "US", AS: "US", MP: "US", UM: "US",
	RE: "FR", YT: "FR", GF: "FR", GP: "FR", MQ: "FR", NC: "FR", PF: "FR", PM: "FR", BL: "FR", MF: "FR", WF: "FR", TF: "FR",
	FO: "DK", GL: "DK", AX: "FI",
	VG: "GB", KY: "GB", BM: "GB", FK: "GB", GI: "GB", IM: "GB", JE: "GB", GG: "GB", SH: "GB", TC: "GB", IO: "GB",
	CW: "NL", BQ: "NL", AW: "NL", SX: "NL",
	HK: "CN", MO: "CN", SJ: "NO",
};

const ALT_COUNTRY_TAGS = new Set([
	"Aland Islands",
	"Cote d'Ivoire",
	"Curacao",
	"Reunion",
	"Sao Tome and Principe",
]);

export const COUNTRY_NAMES_SET = new Set([
	...Object.values(COUNTRY_CODE_TO_NAME),
	...ALT_COUNTRY_TAGS,
]);

export function countryNameForCode(code: string | null | undefined): string | null {
	if (!code) return null;
	const upper = code.toUpperCase();
	const sovereign = TERRITORY_TO_COUNTRY[upper] ?? upper;
	return COUNTRY_CODE_TO_NAME[sovereign] ?? null;
}

export function isCountryTag(name: string | null | undefined): boolean {
	return !!name && COUNTRY_NAMES_SET.has(name);
}
