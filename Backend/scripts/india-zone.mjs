// India service-zone outline, [lat, lng], clockwise from the sea west of Gujarat.
// Deliberately generous: runs a little outside the land border so no Indian address
// near a frontier is cut off, follows India's official boundary (all of J&K incl.
// Gilgit-Baltistan and Aksai Chin), and loops over open sea to include the Andaman &
// Nicobar and Lakshadweep islands while leaving out Sri Lanka and the Maldives.
export const INDIA_OUTLINE = [
  // West coast sea -> Kutch -> Pakistan border (Rajasthan, Punjab)
  [20.0, 68.4], [22.6, 67.7], [23.75, 67.85], [24.4, 68.7], [24.3, 69.55], [24.4, 70.45],
  [24.75, 71.05], [25.35, 70.6], [25.7, 70.1], [26.55, 69.75], [27.1, 69.4], [27.95, 69.95],
  [28.3, 70.85], [29.0, 72.2], [29.9, 73.25], [30.4, 73.8], [31.1, 74.45], [31.65, 74.45],
  [32.1, 74.9], [32.5, 74.6],
  // Official J&K boundary: PoK, Gilgit-Baltistan, Shaksgam, Aksai Chin
  [32.9, 74.0], [33.45, 73.6], [34.3, 73.25], [35.1, 72.9], [35.8, 72.4], [36.45, 72.55],
  [36.95, 73.6], [37.15, 74.6], [36.6, 75.5], [36.3, 76.5], [36.0, 77.6], [35.8, 78.8],
  [35.85, 79.6], [35.4, 80.4], [34.4, 80.3], [33.3, 79.7],
  // Ladakh / Himachal / Uttarakhand vs Tibet, then Nepal's western border
  [32.6, 79.6], [32.0, 79.0], [31.4, 79.3], [30.9, 79.6], [30.5, 80.4], [30.2, 81.15],
  [29.7, 80.65], [29.1, 80.35],
  // South of Nepal (kept just on the Nepal side of the border)
  [28.7, 80.55], [28.45, 81.25], [28.1, 81.85], [27.75, 82.75], [27.5, 83.45], [27.2, 84.15],
  [27.15, 84.7], [26.85, 85.5], [26.6, 86.2], [26.5, 86.95], [26.43, 87.27], [26.5, 87.75], [26.75, 88.05],
  // Sikkim, Bhutan's southern border, Arunachal (McMahon line)
  [27.25, 87.95], [27.75, 88.05], [28.2, 88.6], [27.85, 88.95], [27.15, 89.0], [26.95, 89.6],
  [26.95, 90.5], [26.95, 91.4], [27.05, 92.1], [27.75, 91.6], [28.1, 91.75], [28.3, 92.6],
  [28.7, 93.5], [29.15, 94.4], [29.5, 95.4], [29.45, 96.2], [28.9, 96.75], [28.3, 97.45],
  [27.6, 97.35],
  // Myanmar border (Arunachal, Nagaland, Manipur, Mizoram)
  [27.1, 96.85], [26.6, 96.0], [26.0, 95.35], [25.3, 95.05], [24.6, 94.85], [24.15, 94.45],
  [23.6, 93.75], [22.9, 93.5], [22.2, 93.3], [21.85, 92.85],
  // Around Bangladesh: Mizoram west, Tripura, Barak valley, Meghalaya, Assam, West Bengal
  [22.3, 92.5], [23.0, 92.2], [22.85, 91.85], [22.85, 91.55], [23.2, 91.3], [23.55, 91.22],
  [23.85, 91.15], [24.15, 91.55], [24.25, 91.8], [24.55, 92.05], [24.85, 92.3], [25.05, 92.25],
  [25.05, 91.6], [25.1, 90.5], [25.1, 89.95], [25.55, 89.75], [25.95, 89.75], [26.15, 89.55],
  [26.15, 89.1], [26.1, 88.75], [26.2, 88.45], [25.85, 88.35], [25.15, 88.3], [24.75, 88.0],
  [24.35, 88.55], [24.05, 88.75], [23.6, 88.6], [23.15, 88.85], [22.6, 88.95], [21.9, 89.15],
  // Bay of Bengal, looping out to the Andaman & Nicobar Islands
  [21.0, 89.3], [19.6, 90.9], [17.0, 92.0], [14.9, 92.15], [14.0, 93.25], [12.8, 94.15],
  [9.5, 94.2], [6.45, 94.25], [6.35, 93.3], [7.5, 92.6], [10.0, 91.7], [12.0, 90.0],
  [14.5, 85.0], [16.0, 83.2],
  // East coast (offshore), Palk Strait, Gulf of Mannar, around Kanyakumari
  [14.0, 81.0], [12.0, 80.6], [10.6, 80.25], [10.1, 80.0], [9.6, 79.55], [9.1, 79.45],
  [8.7, 78.7], [7.85, 77.9], [7.6, 77.3],
  // Arabian Sea, looping out to Lakshadweep (keeping clear of the Maldives)
  [7.95, 73.6], [7.95, 72.7], [9.0, 72.1], [10.5, 71.5], [12.5, 71.6], [13.4, 72.9],
  // West coast (offshore) back to Gujarat
  [15.5, 72.9], [18.2, 72.3], [19.8, 71.0], [20.4, 69.9],
];

// Ray casting in (lng, lat).
export const inside = ([lat, lng], poly = INDIA_OUTLINE) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]; const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

const MUST_BE_INSIDE = {
  Bhopal: [23.2599, 77.4126], Delhi: [28.6139, 77.209], Mumbai: [19.076, 72.8777], Kolkata: [22.5726, 88.3639],
  Chennai: [13.0827, 80.2707], Bengaluru: [12.9716, 77.5946], Indore: [22.7196, 75.8577], Goa: [15.4909, 73.8278],
  Manali: [32.2432, 77.1892], Bhuj: [23.242, 69.6669], Jaisalmer: [26.9157, 70.9083], Barmer: [25.75, 71.39],
  Munabao: [25.75, 70.28], Sriganganagar: [29.9038, 73.8772], Fazilka: [30.4036, 74.0281], Firozpur: [30.9331, 74.6225],
  Amritsar: [31.634, 74.8723], Attari: [31.6, 74.6], Gurdaspur: [32.04, 75.4], Jammu: [32.7266, 74.857],
  Srinagar: [34.0837, 74.7973], Kargil: [34.5539, 76.1349], Leh: [34.1526, 77.5771], Muzaffarabad_official: [34.37, 73.47],
  Gilgit_official: [35.92, 74.31], Siachen: [35.42, 77.1], AksaiChin_official: [35.2, 79.5], Shimla: [31.1048, 77.1734],
  Kaza: [32.22, 78.07], Dehradun: [30.3165, 78.0322], Dharchula: [29.85, 80.54], Pithoragarh: [29.58, 80.21],
  Lucknow: [26.8467, 80.9462], Bahraich: [27.57, 81.6], Gorakhpur: [26.76, 83.37], Sonauli: [27.47, 83.47],
  Raxaul: [26.98, 84.85], Jogbani: [26.4, 87.26], Siliguri: [26.7271, 88.3953], Darjeeling: [27.041, 88.2663],
  Gangtok: [27.3389, 88.6065], Kalimpong: [27.06, 88.47], Jaigaon: [26.85, 89.38], Guwahati: [26.1445, 91.7362],
  Tawang: [27.586, 91.8594], Itanagar: [27.0844, 93.6053], Kibithu: [28.28, 97.02], Dibrugarh: [27.4728, 94.912],
  Kohima: [25.6751, 94.1086], Imphal: [24.817, 93.9368], Moreh: [24.25, 94.3], Aizawl: [23.7271, 92.7176],
  Champhai: [23.47, 93.33], Lunglei: [22.88, 92.73], Agartala: [23.8315, 91.2868], Udaipur_Tripura: [23.53, 91.48],
  Belonia: [23.25, 91.45], Dharmanagar: [24.37, 92.17], Karimganj: [24.87, 92.35], Silchar: [24.8333, 92.7789],
  Shillong: [25.5788, 91.8933], Dawki: [25.19, 92.02], Tura: [25.51, 90.22], Dhubri: [26.02, 89.98],
  CoochBehar: [26.3452, 89.4482], Malda: [25.01, 88.14], Berhampore: [24.1, 88.25], Bongaon: [23.05, 88.82],
  Basirhat: [22.66, 88.87], Sagar_island: [21.65, 88.07], Bhubaneswar: [20.2961, 85.8245], Visakhapatnam: [17.6868, 83.2185],
  Puducherry: [11.9416, 79.8083], Rameswaram: [9.2876, 79.3129], Dhanushkodi: [9.18, 79.42], Tuticorin: [8.7642, 78.1348],
  Kanyakumari: [8.0883, 77.5385], Thiruvananthapuram: [8.5241, 76.9366], Kochi: [9.9312, 76.2673], Mangaluru: [12.9141, 74.856],
  Diu: [20.7144, 70.9874], Dwarka: [22.2394, 68.9678], Okha: [22.47, 69.07], Kavaratti: [10.5669, 72.642],
  Minicoy: [8.2833, 73.05], Agatti: [10.85, 72.19], Bitra: [11.6, 72.18], PortBlair: [11.6234, 92.7265],
  Diglipur: [13.27, 93.0], CarNicobar: [9.17, 92.82], CampbellBay: [7.0, 93.93], IndiraPoint: [6.75, 93.84],
};
const MUST_BE_OUTSIDE = {
  Lahore: [31.5204, 74.3587], Karachi: [24.8607, 67.0011], Islamabad: [33.6844, 73.0479], Peshawar: [34.0151, 71.5249],
  Kathmandu: [27.7172, 85.324], Pokhara: [28.2096, 83.9856], Biratnagar: [26.4525, 87.2718], Thimphu: [27.4728, 89.639],
  Dhaka: [23.8103, 90.4125], Chittagong: [22.3569, 91.7832], Sylhet: [24.8949, 91.8687],
  Comilla: [23.46, 91.18], Rajshahi: [24.3745, 88.6042], Khulna: [22.8456, 89.5403], Rangpur: [25.7439, 89.2752],
  Colombo: [6.9271, 79.8612], Jaffna: [9.6615, 80.0255], Male: [4.1755, 73.5093], Yangon: [16.8661, 96.1951],
  Sittwe: [20.15, 92.9], Mandalay: [21.9588, 96.0891], Lhasa: [29.652, 91.1721], Kabul: [34.5553, 69.2075],
};

if (/(^|[/])india-zone.mjs$/.test(process.argv[1] || '')) {
  const badIn = Object.entries(MUST_BE_INSIDE).filter(([, p]) => !inside(p)).map(([n]) => n);
  const badOut = Object.entries(MUST_BE_OUTSIDE).filter(([, p]) => inside(p)).map(([n]) => n);
  console.log(`vertices ${INDIA_OUTLINE.length}`);
  console.log(`inside ok ${Object.keys(MUST_BE_INSIDE).length - badIn.length}/${Object.keys(MUST_BE_INSIDE).length}`, badIn.length ? `MISSING: ${badIn.join(', ')}` : '');
  console.log(`outside ok ${Object.keys(MUST_BE_OUTSIDE).length - badOut.length}/${Object.keys(MUST_BE_OUTSIDE).length}`, badOut.length ? `WRONGLY INSIDE: ${badOut.join(', ')}` : '');
  // Self-intersection check (any two non-adjacent edges crossing).
  const P = INDIA_OUTLINE, n = P.length, seg = (i) => [P[i], P[(i + 1) % n]];
  const orient = (a, b, c) => Math.sign((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]));
  const cross = ([a, b], [c, d]) => orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);
  const hits = [];
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (cross(seg(i), seg(j))) hits.push(`${i}x${j}`); }
  console.log(hits.length ? `SELF-INTERSECTIONS: ${hits.join(' ')}` : 'no self-intersections');
}
