// The world clock's offline city list (78), generated once and kept here: one line per country and time
// zone, "Country|IANA zone|City[=other name...]@lat,lng|...". domain/cities.ts reads it. 1060 cities.
// Names already in the list before 2.9 keep their exact spelling and zone: a saved world clock stores them.
export const CITY_DATA = `United Kingdom|Europe/London|London@51.51,-0.13|Edinburgh@55.95,-3.19|Manchester@53.48,-2.24|Birmingham@52.49,-1.89|Glasgow@55.86,-4.25|Liverpool@53.41,-2.98|Leeds@53.8,-1.55|Bristol@51.45,-2.59|Newcastle@54.98,-1.62|Sheffield@53.38,-1.47|Cardiff@51.48,-3.18|Belfast@54.6,-5.93|Nottingham@52.95,-1.15|Leicester@52.64,-1.13|Southampton@50.9,-1.4|Brighton@50.82,-0.14|Oxford@51.75,-1.26|Cambridge@52.21,0.12|Aberdeen@57.15,-2.09|Plymouth@50.38,-4.14|Swansea@51.62,-3.94|Inverness@57.48,-4.22|York@53.96,-1.08
Ireland|Europe/Dublin|Dublin@53.35,-6.26|Cork@51.9,-8.47|Galway@53.27,-9.05|Limerick@52.66,-8.63
France|Europe/Paris|Paris@48.86,2.35|Lyon@45.76,4.84|Marseille@43.3,5.37|Toulouse@43.6,1.44|Nice@43.7,7.26|Nantes@47.22,-1.55|Strasbourg@48.57,7.75|Montpellier@43.61,3.88|Bordeaux@44.84,-0.58|Lille@50.63,3.06|Rennes@48.11,-1.68|Reims@49.26,4.03|Toulon@43.12,5.93|Grenoble@45.19,5.72|Dijon@47.32,5.04|Angers@47.47,-0.55|Le Havre@49.49,0.11|Ajaccio@41.93,8.74|Brest@48.39,-4.49|Tours@47.39,0.69|Avignon@43.95,4.81|Cannes@43.55,7.01|Biarritz@43.48,-1.56
Belgium|Europe/Brussels|Brussels=Bruxelles=Brussel@50.85,4.35|Antwerp=Antwerpen=Anvers@51.22,4.4|Ghent=Gent@51.05,3.72|Bruges=Brugge@51.21,3.22|Liège@50.63,5.57|Charleroi@50.41,4.44|Leuven@50.88,4.7
Netherlands|Europe/Amsterdam|Amsterdam@52.37,4.9|Rotterdam@51.92,4.48|The Hague=Den Haag@52.07,4.3|Utrecht@52.09,5.12|Eindhoven@51.44,5.47|Groningen@53.22,6.57|Maastricht@50.85,5.69|Haarlem@52.39,4.64
Luxembourg|Europe/Luxembourg|Luxembourg@49.61,6.13
Germany|Europe/Berlin|Berlin@52.52,13.41|Munich=München@48.14,11.58|Frankfurt@50.11,8.68|Hamburg@53.55,9.99|Cologne=Köln@50.94,6.96|Stuttgart@48.78,9.18|Düsseldorf@51.23,6.77|Dortmund@51.51,7.47|Essen@51.46,7.01|Leipzig@51.34,12.37|Bremen@53.08,8.8|Dresden@51.05,13.74|Hanover=Hannover@52.38,9.73|Nuremberg=Nürnberg@49.45,11.08|Duisburg@51.43,6.76|Bochum@51.48,7.22|Bonn@50.74,7.1|Münster@51.96,7.63|Karlsruhe@49.01,8.4|Mannheim@49.49,8.47|Augsburg@48.37,10.9|Wiesbaden@50.08,8.24|Freiburg@47.99,7.84|Heidelberg@49.4,8.67|Kiel@54.32,10.14|Rostock@54.09,12.1|Potsdam@52.39,13.06|Mainz@50,8.27|Erfurt@50.98,11.03|Aachen@50.78,6.08
Switzerland|Europe/Zurich|Zurich=Zürich@47.38,8.54|Geneva=Genève@46.2,6.14|Bern@46.95,7.45|Basel@47.56,7.59|Lausanne@46.52,6.63|Lucerne=Luzern@47.05,8.31|Lugano@46,8.95|St. Gallen@47.42,9.37
Austria|Europe/Vienna|Vienna=Wien@48.21,16.37|Graz@47.07,15.44|Linz@48.31,14.29|Salzburg@47.81,13.04|Innsbruck@47.27,11.4|Klagenfurt@46.62,14.31
Italy|Europe/Rome|Rome=Roma@41.9,12.5|Milan=Milano@45.46,9.19|Naples=Napoli@40.85,14.27|Turin=Torino@45.07,7.69|Palermo@38.12,13.36|Genoa=Genova@44.41,8.93|Bologna@44.49,11.34|Florence=Firenze@43.77,11.26|Bari@41.12,16.87|Catania@37.5,15.09|Venice=Venezia@45.44,12.32|Verona@45.44,10.99|Messina@38.19,15.55|Padua=Padova@45.41,11.88|Trieste@45.65,13.78|Cagliari@39.22,9.11|Pisa@43.72,10.4|Perugia@43.11,12.39|Bergamo@45.7,9.67|Brescia@45.54,10.21|Parma@44.8,10.33|Lecce@40.35,18.17
Spain|Europe/Madrid|Madrid@40.42,-3.7|Barcelona@41.39,2.17|Valencia@39.47,-0.38|Seville=Sevilla@37.39,-5.98|Zaragoza@41.65,-0.89|Málaga@36.72,-4.42|Murcia@37.99,-1.13|Palma=Palma de Mallorca@39.57,2.65|Bilbao@43.26,-2.93|Alicante@38.35,-0.49|Córdoba@37.89,-4.78|Valladolid@41.65,-4.72|Vigo@42.24,-8.72|Gijón@43.54,-5.66|A Coruña=La Coruña@43.36,-8.41|Granada@37.18,-3.6|San Sebastián=Donostia@43.32,-1.98|Santander@43.46,-3.81|Pamplona@42.81,-1.64|Salamanca@40.97,-5.66|Santiago de Compostela@42.88,-8.54|Ibiza@38.91,1.43|Toledo@39.86,-4.02|Cádiz@36.53,-6.29|Tarragona@41.12,1.25|Oviedo@43.36,-5.85|Girona@41.98,2.82
Portugal|Europe/Lisbon|Lisbon=Lisboa@38.72,-9.14|Porto=Oporto@41.15,-8.61|Braga@41.55,-8.42|Coimbra@40.21,-8.43|Faro@37.02,-7.93|Aveiro@40.64,-8.65|Setúbal@38.52,-8.89|Évora@38.57,-7.91|Viseu@40.66,-7.91|Guimarães@41.44,-8.29|Leiria@39.74,-8.81|Viana do Castelo@41.69,-8.83|Lagos@37.1,-8.67|Cascais@38.7,-9.42|Sintra@38.8,-9.38
Denmark|Europe/Copenhagen|Copenhagen=København@55.68,12.57|Aarhus@56.16,10.2|Odense@55.4,10.39|Aalborg@57.05,9.92
Norway|Europe/Oslo|Oslo@59.91,10.75|Bergen@60.39,5.32|Trondheim@63.43,10.4|Stavanger@58.97,5.73|Tromsø@69.65,18.96|Kristiansand@58.15,7.99
Sweden|Europe/Stockholm|Stockholm@59.33,18.07|Gothenburg=Göteborg@57.71,11.97|Malmö@55.6,13|Uppsala@59.86,17.64|Västerås@59.61,16.55|Örebro@59.27,15.21|Linköping@58.41,15.62|Umeå@63.83,20.26|Kiruna@67.86,20.23
Finland|Europe/Helsinki|Helsinki@60.17,24.94|Espoo@60.21,24.66|Tampere@61.5,23.76|Turku@60.45,22.27|Oulu@65.01,25.47|Rovaniemi@66.5,25.73
Iceland|Atlantic/Reykjavik|Reykjavik@64.15,-21.94|Akureyri@65.68,-18.09
Poland|Europe/Warsaw|Warsaw=Warszawa@52.23,21.01|Kraków=Krakow=Cracow@50.06,19.94|Łódź=Lodz@51.76,19.46|Wrocław=Wroclaw@51.11,17.04|Poznań=Poznan@52.41,16.93|Gdańsk=Gdansk@54.35,18.65|Szczecin@53.43,14.55|Bydgoszcz@53.12,18.01|Lublin@51.25,22.57|Katowice@50.26,19.02|Białystok@53.13,23.16|Gdynia@54.52,18.53|Toruń@53.01,18.6
Czechia|Europe/Prague|Prague=Praha@50.08,14.44|Brno@49.2,16.61|Ostrava@49.82,18.26|Plzeň=Pilsen@49.74,13.38|Olomouc@49.59,17.25|Karlovy Vary@50.23,12.87
Slovakia|Europe/Bratislava|Bratislava@48.15,17.11|Košice@48.72,21.26|Žilina@49.22,18.74
Hungary|Europe/Budapest|Budapest@47.5,19.04|Debrecen@47.53,21.63|Szeged@46.25,20.15|Miskolc@48.1,20.78|Pécs@46.07,18.23|Győr@47.69,17.63
Slovenia|Europe/Ljubljana|Ljubljana@46.06,14.51|Maribor@46.55,15.65|Koper@45.55,13.73
Croatia|Europe/Zagreb|Zagreb@45.81,15.98|Split@43.51,16.44|Rijeka@45.33,14.44|Osijek@45.55,18.69|Dubrovnik@42.65,18.09|Zadar@44.12,15.23|Pula@44.87,13.85
Serbia|Europe/Belgrade|Belgrade=Beograd@44.79,20.45|Novi Sad@45.27,19.83|Niš@43.32,21.9|Kragujevac@44.01,20.91
Bosnia and Herzegovina|Europe/Sarajevo|Sarajevo@43.86,18.41|Banja Luka@44.77,17.19|Mostar@43.34,17.81|Tuzla@44.54,18.68
Montenegro|Europe/Podgorica|Podgorica@42.43,19.26|Kotor@42.42,18.77|Budva@42.29,18.84
North Macedonia|Europe/Skopje|Skopje@42,21.43|Ohrid@41.12,20.8|Bitola@41.03,21.33
Albania|Europe/Tirane|Tirana@41.33,19.82|Durrës@41.32,19.45|Vlorë@40.47,19.49|Shkodër@42.07,19.51
Greece|Europe/Athens|Athens=Athina@37.98,23.73|Thessaloniki@40.64,22.94|Patras@38.25,21.73|Heraklion@35.34,25.14|Larissa@39.64,22.42|Rhodes@36.43,28.22|Corfu@39.62,19.92|Chania@35.51,24.02|Ioannina@39.66,20.85|Volos@39.36,22.94|Mykonos@37.45,25.33|Santorini=Fira@36.42,25.43
Bulgaria|Europe/Sofia|Sofia@42.7,23.32|Plovdiv@42.14,24.75|Varna@43.21,27.91|Burgas@42.5,27.47|Ruse@43.85,25.95
Romania|Europe/Bucharest|Bucharest=București@44.43,26.1|Cluj-Napoca=Cluj@46.77,23.6|Timișoara=Timisoara@45.76,21.23|Iași=Iasi@47.16,27.59|Constanța=Constanta@44.18,28.63|Craiova@44.33,23.79|Brașov=Brasov@45.65,25.61|Galați@45.44,28.05|Oradea@47.07,21.92|Sibiu@45.79,24.15
Moldova|Europe/Chisinau|Chisinau@47.01,28.86|Bălți=Balti@47.76,27.93
Ukraine|Europe/Kiev|Kyiv=Kiev@50.45,30.52|Kharkiv@49.99,36.23|Odesa=Odessa@46.48,30.72|Dnipro@48.46,35.05|Lviv=Lvov@49.84,24.03|Zaporizhzhia@47.84,35.14|Kryvyi Rih@47.91,33.39|Mykolaiv@46.98,31.99|Vinnytsia@49.23,28.47|Chernihiv@51.5,31.29|Poltava@49.59,34.55|Uzhhorod@48.62,22.29|Ivano-Frankivsk@48.92,24.71
Belarus|Europe/Minsk|Minsk@53.9,27.56|Gomel=Homel@52.44,30.98|Brest@52.1,23.69|Grodno=Hrodna@53.68,23.83|Vitebsk@55.19,30.2|Mogilev@53.9,30.33
Lithuania|Europe/Vilnius|Vilnius@54.69,25.28|Kaunas@54.9,23.89|Klaipėda=Klaipeda@55.71,21.14
Latvia|Europe/Riga|Riga@56.95,24.11|Daugavpils@55.87,26.54|Liepāja=Liepaja@56.51,21.01
Estonia|Europe/Tallinn|Tallinn@59.44,24.75|Tartu@58.38,26.72|Pärnu@58.39,24.5
Russia|Europe/Moscow|Moscow=Moskva@55.76,37.62|Saint Petersburg=St Petersburg@59.93,30.34|Nizhny Novgorod@56.33,44|Kazan@55.8,49.11|Rostov-on-Don@47.24,39.71|Voronezh@51.67,39.18|Krasnodar@45.04,38.98|Sochi@43.6,39.73|Murmansk@68.97,33.08|Arkhangelsk@64.54,40.54|Yaroslavl@57.63,39.87|Tula@54.19,37.62
Turkey|Europe/Istanbul|Istanbul@41.01,28.98|Ankara@39.93,32.85|İzmir=Izmir@38.42,27.13|Bursa@40.19,29.06|Antalya@36.9,30.71|Adana@37,35.32|Konya@37.87,32.48|Gaziantep@37.07,37.38|Trabzon@41,39.72|Kayseri@38.73,35.49|Bodrum@37.03,27.43|Diyarbakır@37.91,40.23
Malta|Europe/Malta|Valletta@35.9,14.51|Sliema@35.91,14.5
Monaco|Europe/Monaco|Monaco@43.74,7.42
Andorra|Europe/Andorra|Andorra la Vella@42.51,1.52
Cyprus|Asia/Nicosia|Nicosia@35.19,33.38|Limassol@34.68,33.04|Larnaca@34.92,33.63|Paphos@34.77,32.42
Georgia|Asia/Tbilisi|Tbilisi@41.72,44.79|Batumi@41.64,41.63|Kutaisi@42.27,42.7
Armenia|Asia/Yerevan|Yerevan@40.18,44.51|Gyumri@40.79,43.85
Azerbaijan|Asia/Baku|Baku@40.41,49.87|Ganja@40.68,46.36
Portugal (Azores)|Atlantic/Azores|Ponta Delgada@37.74,-25.67|Angra do Heroísmo@38.65,-27.22|Horta@38.53,-28.63
Portugal (Madeira)|Atlantic/Madeira|Funchal@32.65,-16.91
Spain (Canary Islands)|Atlantic/Canary|Las Palmas@28.12,-15.43|Santa Cruz de Tenerife=Tenerife@28.46,-16.25|Arrecife=Lanzarote@28.96,-13.55|Puerto del Rosario=Fuerteventura@28.5,-13.86
Egypt|Africa/Cairo|Cairo@30.04,31.24|Alexandria@31.2,29.92|Giza@30.01,31.21|Luxor@25.69,32.64|Aswan@24.09,32.9|Sharm El Sheikh@27.92,34.33|Hurghada@27.26,33.81|Port Said@31.27,32.3
Morocco|Africa/Casablanca|Casablanca@33.57,-7.59|Rabat@34.02,-6.84|Marrakesh=Marrakech@31.63,-8.01|Fez=Fès@34.03,-5|Tangier=Tanger@35.76,-5.83|Agadir@30.43,-9.6|Meknes@33.9,-5.55
Algeria|Africa/Algiers|Algiers@36.75,3.06|Oran@35.7,-0.63|Constantine@36.37,6.61|Annaba@36.9,7.77
Tunisia|Africa/Tunis|Tunis@36.81,10.18|Sfax@34.74,10.76|Sousse@35.83,10.64
Libya|Africa/Tripoli|Tripoli@32.89,13.19|Benghazi@32.12,20.07
Sudan|Africa/Khartoum|Khartoum@15.5,32.56|Omdurman@15.64,32.48|Port Sudan@19.62,37.22
Ethiopia|Africa/Addis_Ababa|Addis Ababa@9.03,38.74|Dire Dawa@9.59,41.86
Kenya|Africa/Nairobi|Nairobi@-1.29,36.82|Mombasa@-4.04,39.67|Kisumu@-0.09,34.77
Uganda|Africa/Kampala|Kampala@0.35,32.58|Entebbe@0.05,32.46
Rwanda|Africa/Kigali|Kigali@-1.95,30.06
Tanzania|Africa/Dar_es_Salaam|Dar es Salaam@-6.79,39.21|Dodoma@-6.16,35.75|Arusha@-3.39,36.68|Zanzibar@-6.17,39.2|Mwanza@-2.52,32.9
Nigeria|Africa/Lagos|Lagos@6.52,3.38|Abuja@9.08,7.4|Kano@12,8.52|Ibadan@7.38,3.95|Port Harcourt@4.82,7.05|Benin City@6.34,5.63|Kaduna@10.52,7.44|Enugu@6.45,7.51
Ghana|Africa/Accra|Accra@5.6,-0.19|Kumasi@6.69,-1.62|Tamale@9.4,-0.85
Senegal|Africa/Dakar|Dakar@14.69,-17.44|Saint-Louis@16.03,-16.49|Touba@14.85,-15.88
Côte d'Ivoire|Africa/Abidjan|Abidjan@5.36,-4.01|Yamoussoukro@6.83,-5.29|Bouaké@7.69,-5.03
Mali|Africa/Bamako|Bamako@12.64,-8|Timbuktu@16.77,-3.01
DR Congo|Africa/Kinshasa|Kinshasa@-4.44,15.27|Kisangani@0.52,25.19
Angola|Africa/Luanda|Luanda@-8.84,13.23|Huambo@-12.78,15.74|Lobito@-12.35,13.55
Zambia|Africa/Lusaka|Lusaka@-15.39,28.32|Ndola@-12.97,28.64|Livingstone@-17.84,25.86
Zimbabwe|Africa/Harare|Harare@-17.83,31.05|Bulawayo@-20.15,28.58
Mozambique|Africa/Maputo|Maputo@-25.97,32.57|Beira@-19.84,34.84|Nampula@-15.12,39.27
Namibia|Africa/Windhoek|Windhoek@-22.56,17.08|Walvis Bay@-22.96,14.51
South Africa|Africa/Johannesburg|Johannesburg@-26.2,28.05|Cape Town@-33.92,18.42|Pretoria@-25.75,28.19|Durban@-29.86,31.03|Port Elizabeth=Gqeberha@-33.96,25.6|Bloemfontein@-29.09,26.16|Soweto@-26.27,27.86|East London@-33.02,27.91|Pietermaritzburg@-29.6,30.38|Stellenbosch@-33.93,18.86
Madagascar|Indian/Antananarivo|Antananarivo@-18.88,47.51|Toamasina@-18.15,49.4
Mauritius|Indian/Mauritius|Port Louis@-20.16,57.5
Cape Verde|Atlantic/Cape_Verde|Praia@14.93,-23.51|Mindelo@16.89,-24.98
United Arab Emirates|Asia/Dubai|Dubai@25.2,55.27|Abu Dhabi@24.45,54.38|Sharjah@25.35,55.42|Al Ain@24.21,55.74
Qatar|Asia/Qatar|Doha@25.29,51.53
Saudi Arabia|Asia/Riyadh|Riyadh@24.71,46.68|Jeddah@21.49,39.19|Mecca=Makkah@21.39,39.86|Medina=Madinah@24.47,39.61|Dammam@26.43,50.1
Kuwait|Asia/Kuwait|Kuwait City=Kuwait@29.38,47.99
Bahrain|Asia/Bahrain|Manama@26.23,50.59
Oman|Asia/Muscat|Muscat@23.59,58.41|Salalah@17.02,54.09
Iran|Asia/Tehran|Tehran@35.69,51.39|Mashhad@36.3,59.61|Isfahan@32.65,51.67|Tabriz@38.08,46.29|Shiraz@29.59,52.58|Karaj@35.84,50.94
Iraq|Asia/Baghdad|Baghdad@33.31,44.36|Basra@30.51,47.78|Mosul@36.34,43.13|Erbil@36.19,44.01
Jordan|Asia/Amman|Amman@31.95,35.93|Aqaba@29.53,35.01|Irbid@32.56,35.85
Lebanon|Asia/Beirut|Beirut@33.89,35.5|Tripoli@34.44,35.83
Syria|Asia/Damascus|Damascus@33.51,36.28|Aleppo@36.2,37.13|Homs@34.73,36.71
Israel|Asia/Jerusalem|Jerusalem@31.77,35.21|Tel Aviv@32.09,34.78|Haifa@32.79,34.99|Eilat@29.56,34.95
Afghanistan|Asia/Kabul|Kabul@34.56,69.21|Kandahar@31.63,65.71|Herat@34.35,62.2|Mazar-i-Sharif@36.71,67.11
Pakistan|Asia/Karachi|Karachi@24.86,67.01|Islamabad@33.68,73.05|Lahore@31.55,74.34|Faisalabad@31.42,73.08|Rawalpindi@33.6,73.05|Peshawar@34.01,71.58|Multan@30.16,71.52|Quetta@30.18,66.98
India|Asia/Kolkata|New Delhi=Delhi@28.61,77.21|Mumbai=Bombay@19.08,72.88|Bangalore=Bengaluru@12.97,77.59|Chennai=Madras@13.08,80.27|Kolkata=Calcutta@22.57,88.36|Hyderabad@17.39,78.49|Ahmedabad@23.02,72.57|Pune@18.52,73.86|Surat@21.17,72.83|Jaipur@26.91,75.79|Lucknow@26.85,80.95|Kanpur@26.45,80.33|Nagpur@21.15,79.09|Indore@22.72,75.86|Bhopal@23.26,77.41|Patna@25.59,85.14|Vadodara@22.31,73.18|Ludhiana@30.9,75.86|Agra@27.18,78.01|Varanasi@25.32,82.97|Amritsar@31.63,74.87|Chandigarh@30.73,76.78|Kochi=Cochin@9.93,76.27|Thiruvananthapuram=Trivandrum@8.52,76.94|Coimbatore@11.02,76.96|Visakhapatnam@17.69,83.22|Goa=Panaji@15.49,73.83|Guwahati@26.14,91.74|Bhubaneswar@20.3,85.82|Srinagar@34.08,74.8|Mysore=Mysuru@12.3,76.64|Udaipur@24.59,73.71|Dehradun@30.32,78.03|Shimla@31.1,77.17|Port Blair@11.62,92.73
Nepal|Asia/Kathmandu|Kathmandu@27.72,85.32|Pokhara@28.21,83.99
Bhutan|Asia/Thimphu|Thimphu@27.47,89.64
Bangladesh|Asia/Dhaka|Dhaka@23.81,90.41|Chittagong=Chattogram@22.36,91.78|Khulna@22.85,89.54|Sylhet@24.89,91.87
Sri Lanka|Asia/Colombo|Colombo@6.93,79.85|Kandy@7.29,80.63|Galle@6.05,80.22|Sri Jayawardenepura Kotte@6.89,79.92
Maldives|Indian/Maldives|Malé@4.18,73.51
Uzbekistan|Asia/Tashkent|Tashkent@41.3,69.24
Kazakhstan|Asia/Almaty|Almaty@43.24,76.89|Astana@51.17,71.45|Shymkent@42.32,69.59|Karaganda@49.81,73.09
Kyrgyzstan|Asia/Bishkek|Bishkek@42.87,74.59
Tajikistan|Asia/Dushanbe|Dushanbe@38.56,68.79
Turkmenistan|Asia/Ashgabat|Ashgabat@37.96,58.33
Russia|Asia/Yekaterinburg|Yekaterinburg@56.84,60.61|Chelyabinsk@55.16,61.4|Ufa@54.74,55.97|Perm@58.01,56.25|Tyumen@57.15,65.53
Russia|Asia/Novosibirsk|Novosibirsk@55.01,82.93
Russia|Asia/Vladivostok|Vladivostok@43.12,131.89
Mongolia|Asia/Ulaanbaatar|Ulaanbaatar@47.89,106.91
China|Asia/Shanghai|Beijing=Peking@39.9,116.41|Shanghai@31.23,121.47|Shenzhen@22.54,114.06|Guangzhou=Canton@23.13,113.26|Chengdu@30.57,104.07|Chongqing@29.56,106.55|Tianjin@39.34,117.36|Wuhan@30.59,114.31|Xi'an@34.34,108.94|Hangzhou@30.27,120.16|Nanjing@32.06,118.8|Shenyang@41.81,123.43|Harbin@45.8,126.53|Qingdao@36.07,120.38|Dalian@38.91,121.6|Xiamen@24.48,118.09|Suzhou@31.3,120.59|Zhengzhou@34.75,113.63|Changsha@28.23,112.94|Kunming@25.04,102.71|Jinan@36.65,117.12|Fuzhou@26.07,119.3|Nanning@22.82,108.32|Hefei@31.82,117.23|Lhasa@29.65,91.17|Sanya@18.25,109.51|Guilin@25.27,110.29|Dongguan@23.02,113.75|Hohhot@40.84,111.75
Hong Kong|Asia/Hong_Kong|Hong Kong@22.32,114.17
Macau|Asia/Macau|Macau@22.2,113.54
Taiwan|Asia/Taipei|Taipei@25.03,121.57|Kaohsiung@22.63,120.3|Taichung@24.15,120.67|Tainan@22.99,120.21
South Korea|Asia/Seoul|Seoul@37.57,126.98|Busan@35.18,129.08|Incheon@37.46,126.71|Daegu@35.87,128.6|Daejeon@36.35,127.38|Gwangju@35.16,126.85|Ulsan@35.54,129.31|Jeju@33.5,126.53
North Korea|Asia/Pyongyang|Pyongyang@39.04,125.76
Japan|Asia/Tokyo|Tokyo@35.68,139.69|Osaka@34.69,135.5|Yokohama@35.44,139.64|Nagoya@35.18,136.91|Sapporo@43.06,141.35|Fukuoka@33.59,130.4|Kobe@34.69,135.2|Kyoto@35.01,135.77|Kawasaki@35.53,139.7|Saitama@35.86,139.65|Hiroshima@34.39,132.46|Sendai@38.27,140.87|Naha=Okinawa@26.21,127.68|Nara@34.69,135.8|Kanazawa@36.56,136.66|Nagasaki@32.75,129.88|Kagoshima@31.6,130.56
Thailand|Asia/Bangkok|Bangkok@13.76,100.5|Chiang Mai@18.79,98.98|Phuket@7.88,98.39|Pattaya@12.93,100.88|Krabi@8.09,98.91|Hat Yai@7.01,100.47
Vietnam|Asia/Ho_Chi_Minh|Hanoi@21.03,105.85|Ho Chi Minh City=Saigon@10.82,106.63|Da Nang@16.05,108.2|Hai Phong@20.86,106.68|Hue@16.46,107.59|Nha Trang@12.24,109.2|Can Tho@10.05,105.75
Cambodia|Asia/Phnom_Penh|Phnom Penh@11.56,104.93|Siem Reap@13.36,103.86
Laos|Asia/Vientiane|Vientiane@17.98,102.63|Luang Prabang@19.89,102.14
Myanmar|Asia/Yangon|Yangon=Rangoon@16.87,96.2|Naypyidaw@19.76,96.08|Mandalay@21.98,96.08
Malaysia|Asia/Kuala_Lumpur|Kuala Lumpur@3.14,101.69|George Town=Penang@5.41,100.33|Johor Bahru@1.49,103.74|Ipoh@4.6,101.08|Malacca=Melaka@2.19,102.25|Putrajaya@2.93,101.69
Singapore|Asia/Singapore|Singapore@1.35,103.82
Indonesia|Asia/Jakarta|Jakarta@-6.21,106.85|Surabaya@-7.25,112.75|Bandung@-6.92,107.62|Medan@3.6,98.67|Semarang@-6.97,110.42|Palembang@-2.98,104.76|Yogyakarta@-7.8,110.36|Malang@-7.98,112.63
Indonesia (Bali)|Asia/Makassar|Denpasar@-8.65,115.22
Philippines|Asia/Manila|Manila@14.6,120.98|Quezon City@14.68,121.04|Cebu City@10.32,123.89|Davao City@7.19,125.46|Makati@14.55,121.02|Zamboanga@6.92,122.08|Baguio@16.4,120.6
Brunei|Asia/Brunei|Bandar Seri Begawan@4.9,114.94
Timor-Leste|Asia/Dili|Dili@-8.56,125.57
Australia|Australia/Sydney|Sydney@-33.87,151.21|Canberra@-35.28,149.13|Newcastle (NSW)@-32.93,151.78|Wollongong@-34.42,150.89
Australia|Australia/Melbourne|Melbourne@-37.81,144.96|Geelong@-38.15,144.36
Australia|Australia/Brisbane|Brisbane@-27.47,153.03|Gold Coast@-28.02,153.4|Cairns@-16.92,145.77|Townsville@-19.26,146.82|Sunshine Coast@-26.65,153.07
Australia|Australia/Perth|Perth@-31.95,115.86
Australia|Australia/Adelaide|Adelaide@-34.93,138.6
Australia|Australia/Darwin|Darwin@-12.46,130.84|Alice Springs@-23.7,133.88
Australia|Australia/Hobart|Hobart@-42.88,147.33
New Zealand|Pacific/Auckland|Auckland@-36.85,174.76|Wellington@-41.29,174.78|Christchurch@-43.53,172.64|Hamilton@-37.79,175.28|Dunedin@-45.87,170.5|Queenstown@-45.03,168.66|Tauranga@-37.69,176.17
Fiji|Pacific/Fiji|Suva@-18.14,178.44|Nadi@-17.8,177.42
Papua New Guinea|Pacific/Port_Moresby|Port Moresby@-9.44,147.18
New Caledonia|Pacific/Noumea|Nouméa@-22.28,166.46
French Polynesia|Pacific/Tahiti|Papeete@-17.54,-149.57
Samoa|Pacific/Apia|Apia@-13.83,-171.76
Tonga|Pacific/Tongatapu|Nuku'alofa@-21.14,-175.2
Guam|Pacific/Guam|Guam@13.44,144.79
United States (Hawaii)|Pacific/Honolulu|Honolulu@21.31,-157.86|Hilo@19.71,-155.09
United States|America/New_York|New York@40.71,-74.01|Washington, D.C.=Washington@38.91,-77.04|Boston@42.36,-71.06|Miami@25.76,-80.19|Atlanta@33.75,-84.39|Philadelphia@39.95,-75.17|Pittsburgh@40.44,-80|Baltimore@39.29,-76.61|Charlotte@35.23,-80.84|Orlando@28.54,-81.38|Tampa@27.95,-82.46|Jacksonville@30.33,-81.66|Detroit@42.33,-83.05|Cleveland@41.5,-81.69|Columbus@39.96,-83|Cincinnati@39.1,-84.51|Indianapolis@39.77,-86.16|Raleigh@35.78,-78.64|Richmond@37.54,-77.44|Buffalo@42.89,-78.88|Providence@41.82,-71.41|Hartford@41.76,-72.68|Newark@40.74,-74.17|Savannah@32.08,-81.09|Charleston@32.78,-79.93|Albany@42.65,-73.76|Portland (Maine)@43.66,-70.26|Key West@24.56,-81.78|Louisville@38.25,-85.76
United States|America/Chicago|Chicago@41.88,-87.63|Dallas@32.78,-96.8|Houston@29.76,-95.37|San Antonio@29.42,-98.49|Austin@30.27,-97.74|Fort Worth@32.76,-97.33|Minneapolis@44.98,-93.27|St. Louis@38.63,-90.2|Kansas City@39.1,-94.58|New Orleans@29.95,-90.07|Nashville@36.16,-86.78|Memphis@35.15,-90.05|Milwaukee@43.04,-87.91|Oklahoma City@35.47,-97.52|Omaha@41.26,-95.93|Des Moines@41.59,-93.62|Madison@43.07,-89.4|Birmingham (Alabama)@33.52,-86.81|Little Rock@34.75,-92.29
United States|America/Denver|Denver@39.74,-104.99|Salt Lake City@40.76,-111.89|Albuquerque@35.08,-106.65|El Paso@31.76,-106.49|Colorado Springs@38.83,-104.82|Boise@43.62,-116.2|Santa Fe@35.69,-105.94
United States|America/Phoenix|Phoenix@33.45,-112.07|Tucson@32.22,-110.97
United States|America/Los_Angeles|Los Angeles@34.05,-118.24|San Francisco@37.77,-122.42|Seattle@47.61,-122.33|Las Vegas@36.17,-115.14|San Diego@32.72,-117.16|San Jose@37.34,-121.89|Sacramento@38.58,-121.49|Portland@45.52,-122.68|Oakland@37.8,-122.27|Fresno@36.74,-119.79|Long Beach@33.77,-118.19|Reno@39.53,-119.81|Palo Alto@37.44,-122.14
United States (Alaska)|America/Anchorage|Anchorage@61.22,-149.9|Fairbanks@64.84,-147.72
Canada|America/Toronto|Toronto@43.65,-79.38|Ottawa@45.42,-75.7|Montreal@45.5,-73.57|Quebec City@46.81,-71.21|Mississauga@43.59,-79.64|Hamilton (Ontario)@43.26,-79.87|London (Ontario)@42.98,-81.25|Kitchener@43.45,-80.49
Canada|America/Vancouver|Vancouver@49.28,-123.12|Victoria (BC)@48.43,-123.37|Whistler@50.12,-122.95
Canada|America/Edmonton|Calgary@51.05,-114.07|Edmonton@53.55,-113.49
Canada|America/Winnipeg|Winnipeg@49.9,-97.14
Canada|America/Halifax|Halifax@44.65,-63.58|Charlottetown@46.24,-63.13
Canada|America/St_Johns|St. John's@47.56,-52.71
Mexico|America/Mexico_City|Mexico City=Ciudad de México@19.43,-99.13|Guadalajara@20.66,-103.35|Puebla@19.04,-98.21|León@21.12,-101.68|Querétaro@20.59,-100.39|Oaxaca@17.07,-96.73|Acapulco@16.85,-99.82|Veracruz@19.17,-96.13|Aguascalientes@21.88,-102.29|Morelia@19.7,-101.18|Mérida@20.97,-89.62|San Luis Potosí@22.16,-100.98|Toluca@19.28,-99.66
Mexico|America/Monterrey|Monterrey@25.69,-100.32
Mexico|America/Cancun|Cancún@21.16,-86.85|Playa del Carmen@20.63,-87.08|Tulum@20.21,-87.47
Mexico|America/Tijuana|Tijuana@32.51,-117.04
Guatemala|America/Guatemala|Guatemala City@14.63,-90.51|Antigua Guatemala@14.56,-90.73|Quetzaltenango@14.83,-91.52
El Salvador|America/El_Salvador|San Salvador@13.69,-89.22
Honduras|America/Tegucigalpa|Tegucigalpa@14.07,-87.19|San Pedro Sula@15.5,-88.03|Roatán@16.32,-86.54
Nicaragua|America/Managua|Managua@12.11,-86.24
Costa Rica|America/Costa_Rica|San José@9.93,-84.08|Liberia (Costa Rica)@10.63,-85.44
Panama|America/Panama|Panama City@8.98,-79.52|Colón@9.36,-79.9
Cuba|America/Havana|Havana@23.11,-82.37|Santiago de Cuba@20.02,-75.82|Varadero@23.15,-81.25
Jamaica|America/Jamaica|Kingston@17.97,-76.79
Dominican Republic|America/Santo_Domingo|Santo Domingo@18.49,-69.93|Punta Cana@18.58,-68.4|Santiago de los Caballeros@19.45,-70.7
Puerto Rico|America/Puerto_Rico|San Juan@18.47,-66.11|Ponce@18.01,-66.61
Trinidad and Tobago|America/Port_of_Spain|Port of Spain@10.65,-61.5
Barbados|America/Barbados|Bridgetown@13.1,-59.61
Bermuda|Atlantic/Bermuda|Hamilton@32.29,-64.78
Greenland|America/Nuuk|Nuuk@64.18,-51.72|Ilulissat@69.22,-51.1
Colombia|America/Bogota|Bogotá@4.71,-74.07|Medellín@6.24,-75.58|Cali@3.45,-76.53|Barranquilla@10.97,-74.8|Cartagena@10.39,-75.48|Bucaramanga@7.12,-73.12|Santa Marta@11.24,-74.2
Venezuela|America/Caracas|Caracas@10.48,-66.9|Maracaibo@10.65,-71.64|Valencia (Venezuela)@10.16,-68|Barquisimeto@10.07,-69.32
Ecuador|America/Guayaquil|Quito@-0.18,-78.47|Guayaquil@-2.17,-79.92|Cuenca@-2.9,-79
Peru|America/Lima|Lima@-12.05,-77.04|Arequipa@-16.41,-71.54|Trujillo@-8.11,-79.03|Cusco=Cuzco@-13.53,-71.97|Iquitos@-3.75,-73.25|Piura@-5.19,-80.63
Bolivia|America/La_Paz|La Paz@-16.5,-68.15|Santa Cruz de la Sierra@-17.78,-63.18|Cochabamba@-17.41,-66.16|Sucre@-19.05,-65.26|El Alto@-16.5,-68.19
Chile|America/Santiago|Santiago@-33.45,-70.67|Valparaíso@-33.05,-71.62|Concepción@-36.83,-73.05|Antofagasta@-23.65,-70.4|Viña del Mar@-33.02,-71.55|La Serena@-29.9,-71.25|Temuco@-38.74,-72.6
Argentina|America/Argentina/Buenos_Aires|Buenos Aires@-34.6,-58.38|La Plata@-34.92,-57.95|Mar del Plata@-38,-57.56
Uruguay|America/Montevideo|Montevideo@-34.9,-56.16|Punta del Este@-34.96,-54.95|Salto@-31.39,-57.96
Paraguay|America/Asuncion|Asunción@-25.26,-57.58|Ciudad del Este@-25.51,-54.61
Brazil|America/Sao_Paulo|São Paulo@-23.55,-46.63|Rio de Janeiro@-22.91,-43.17|Brasília@-15.79,-47.88|Belo Horizonte@-19.92,-43.94|Curitiba@-25.43,-49.27|Porto Alegre@-30.03,-51.23|Campinas@-22.91,-47.06|Florianópolis@-27.6,-48.55|Goiânia@-16.69,-49.26|Santos@-23.96,-46.33|Vitória@-20.32,-40.34
Brazil|America/Manaus|Manaus@-3.12,-60.02
Liechtenstein|Europe/Vaduz|Vaduz@47.14,9.52
San Marino|Europe/San_Marino|San Marino@43.94,12.45
Vatican City|Europe/Vatican|Vatican City@41.9,12.45
Gibraltar|Europe/Gibraltar|Gibraltar@36.14,-5.35
Faroe Islands|Atlantic/Faroe|Tórshavn@62.01,-6.77
Svalbard|Arctic/Longyearbyen|Longyearbyen@78.22,15.65
Åland|Europe/Mariehamn|Mariehamn@60.1,19.94
Kosovo|Europe/Belgrade|Pristina=Prishtina@42.66,21.17|Prizren@42.21,20.74
Transnistria|Europe/Chisinau|Tiraspol@46.84,29.63
Ukraine (Crimea)|Europe/Simferopol|Simferopol@44.95,34.1|Sevastopol@44.62,33.52
Russia|Europe/Kaliningrad|Kaliningrad@54.71,20.51
Russia|Europe/Samara|Samara@53.2,50.15|Izhevsk@56.85,53.2
Russia|Europe/Volgograd|Volgograd@48.71,44.51
Russia|Asia/Omsk|Omsk@54.99,73.37
Russia|Asia/Krasnoyarsk|Krasnoyarsk@56.01,92.89
Russia|Asia/Irkutsk|Irkutsk@52.29,104.28
Russia|Asia/Yakutsk|Yakutsk@62.03,129.73
Russia|Asia/Magadan|Magadan@59.56,150.81
Russia|Asia/Kamchatka|Petropavlovsk-Kamchatsky@53.02,158.65
Isle of Man|Europe/Isle_of_Man|Douglas@54.15,-4.48
Jersey|Europe/Jersey|St Helier@49.19,-2.11
Guernsey|Europe/Guernsey|St Peter Port@49.46,-2.54
South Sudan|Africa/Juba|Juba@4.85,31.58
Eritrea|Africa/Asmara|Asmara@15.33,38.93
Djibouti|Africa/Djibouti|Djibouti@11.59,43.15
Somalia|Africa/Mogadishu|Mogadishu@2.05,45.32|Hargeisa@9.56,44.06
Burundi|Africa/Bujumbura|Gitega@-3.43,29.93|Bujumbura@-3.38,29.36
Togo|Africa/Lome|Lomé=Lome@6.13,1.22
Benin|Africa/Porto-Novo|Porto-Novo@6.5,2.6|Cotonou@6.37,2.39
Burkina Faso|Africa/Ouagadougou|Ouagadougou@12.37,-1.52
Niger|Africa/Niamey|Niamey@13.51,2.11
Chad|Africa/Ndjamena|N'Djamena@12.13,15.06
Cameroon|Africa/Douala|Yaoundé=Yaounde@3.85,11.5|Douala@4.05,9.77
Central African Republic|Africa/Bangui|Bangui@4.39,18.56
Gabon|Africa/Libreville|Libreville@0.42,9.47
Equatorial Guinea|Africa/Malabo|Malabo@3.75,8.78
Republic of the Congo|Africa/Brazzaville|Brazzaville@-4.26,15.24|Pointe-Noire@-4.78,11.86
DR Congo|Africa/Lubumbashi|Lubumbashi@-11.66,27.48|Goma@-1.68,29.22
São Tomé and Príncipe|Africa/Sao_Tome|São Tomé@0.34,6.73
Gambia|Africa/Banjul|Banjul@13.45,-16.58
Guinea-Bissau|Africa/Bissau|Bissau@11.86,-15.6
Guinea|Africa/Conakry|Conakry@9.64,-13.58
Sierra Leone|Africa/Freetown|Freetown@8.47,-13.23
Liberia|Africa/Monrovia|Monrovia@6.3,-10.8
Mauritania|Africa/Nouakchott|Nouakchott@18.08,-15.98
Western Sahara|Africa/El_Aaiun|Laayoune@27.15,-13.2
Malawi|Africa/Blantyre|Lilongwe@-13.96,33.79|Blantyre@-15.79,35
Botswana|Africa/Gaborone|Gaborone@-24.65,25.91
Lesotho|Africa/Maseru|Maseru@-29.31,27.48
Eswatini|Africa/Mbabane|Mbabane@-26.31,31.14
Comoros|Indian/Comoro|Moroni@-11.7,43.26
Mayotte|Indian/Mayotte|Mamoudzou@-12.78,45.23
Réunion|Indian/Reunion|Saint-Denis@-20.88,55.45
Seychelles|Indian/Mahe|Victoria@-4.62,55.45
Saint Helena|Atlantic/St_Helena|Jamestown@-15.92,-5.72
Yemen|Asia/Aden|Sanaa=Sana'a@15.37,44.19|Aden@12.79,45.03
Palestine|Asia/Gaza|Gaza@31.5,34.47
Palestine|Asia/Hebron|Ramallah@31.9,35.2|Bethlehem@31.71,35.2
Uzbekistan|Asia/Samarkand|Samarkand@39.65,66.96|Bukhara@39.77,64.42
Kazakhstan|Asia/Aqtobe|Aktobe@50.28,57.17
China|Asia/Urumqi|Ürümqi=Urumqi@43.83,87.62|Kashgar@39.47,75.99
Mongolia|Asia/Hovd|Khovd@48.01,91.64
Malaysia|Asia/Kuching|Kuching@1.55,110.36|Kota Kinabalu@5.98,116.07
Indonesia|Asia/Pontianak|Pontianak@-0.03,109.33
Indonesia|Asia/Makassar|Makassar@-5.15,119.43|Balikpapan@-1.27,116.83|Mataram=Lombok@-8.58,116.12|Nusantara@-0.97,116.71
Indonesia|Asia/Jayapura|Jayapura@-2.53,140.72|Ambon@-3.7,128.18
Australia|Australia/Lord_Howe|Lord Howe Island@-31.55,159.08
New Zealand (Chatham Islands)|Pacific/Chatham|Waitangi@-43.95,-176.56
Vanuatu|Pacific/Efate|Port Vila@-17.73,168.32
Solomon Islands|Pacific/Guadalcanal|Honiara@-9.43,159.95
Kiribati|Pacific/Tarawa|Tarawa@1.33,172.98
Kiribati|Pacific/Kiritimati|Kiritimati@1.87,-157.36
Marshall Islands|Pacific/Majuro|Majuro@7.09,171.38
Micronesia|Pacific/Pohnpei|Palikir@6.92,158.16
Palau|Pacific/Palau|Ngerulmud@7.5,134.62
Nauru|Pacific/Nauru|Yaren@-0.55,166.92
Tuvalu|Pacific/Funafuti|Funafuti@-8.52,179.2
Cook Islands|Pacific/Rarotonga|Avarua@-21.21,-159.78
Niue|Pacific/Niue|Alofi@-19.06,-169.92
American Samoa|Pacific/Pago_Pago|Pago Pago@-14.28,-170.7
Northern Mariana Islands|Pacific/Saipan|Saipan@15.18,145.75
French Polynesia|Pacific/Marquesas|Nuku Hiva@-8.91,-140.1
Wallis and Futuna|Pacific/Wallis|Mata-Utu@-13.28,-176.17
Pitcairn Islands|Pacific/Pitcairn|Adamstown@-25.07,-130.1
Chile (Easter Island)|Pacific/Easter|Hanga Roa=Easter Island@-27.15,-109.43
United States (Alaska)|America/Juneau|Juneau@58.3,-134.42
Canada|America/Regina|Regina@50.45,-104.62|Saskatoon@52.13,-106.67
Canada|America/Moncton|Moncton@46.09,-64.78|Fredericton@45.96,-66.64
Canada|America/Whitehorse|Whitehorse@60.72,-135.06
Canada|America/Yellowknife|Yellowknife@62.45,-114.37
Canada|America/Iqaluit|Iqaluit@63.75,-68.52
Mexico|America/Chihuahua|Chihuahua@28.64,-106.09
Mexico|America/Ciudad_Juarez|Ciudad Juárez@31.69,-106.42
Mexico|America/Hermosillo|Hermosillo@29.07,-110.96
Mexico|America/Mazatlan|Mazatlán@23.25,-106.41|La Paz (Mexico)@24.14,-110.31|Cabo San Lucas@22.89,-109.91
Mexico|America/Bahia_Banderas|Puerto Vallarta@20.65,-105.23
Belize|America/Belize|Belmopan@17.25,-88.76|Belize City@17.5,-88.2
Haiti|America/Port-au-Prince|Port-au-Prince@18.59,-72.31
Bahamas|America/Nassau|Nassau@25.04,-77.35
Turks and Caicos|America/Grand_Turk|Cockburn Town@21.46,-71.14
Cayman Islands|America/Cayman|George Town (Cayman)@19.29,-81.37
US Virgin Islands|America/St_Thomas|Charlotte Amalie@18.34,-64.93
British Virgin Islands|America/Tortola|Road Town@18.43,-64.62
Anguilla|America/Anguilla|The Valley@18.22,-63.06
Saint Martin|America/Marigot|Marigot@18.07,-63.08
Sint Maarten|America/Lower_Princes|Philipsburg@18.03,-63.05
Saint Barthélemy|America/St_Barthelemy|Gustavia@17.9,-62.85
Antigua and Barbuda|America/Antigua|St. John's (Antigua)@17.12,-61.85
Saint Kitts and Nevis|America/St_Kitts|Basseterre@17.3,-62.73
Montserrat|America/Montserrat|Brades@16.79,-62.21
Guadeloupe|America/Guadeloupe|Pointe-à-Pitre@16.24,-61.53
Dominica|America/Dominica|Roseau@15.3,-61.39
Martinique|America/Martinique|Fort-de-France@14.61,-61.07
Saint Lucia|America/St_Lucia|Castries@14.01,-60.99
Saint Vincent and the Grenadines|America/St_Vincent|Kingstown@13.16,-61.22
Grenada|America/Grenada|St. George's@12.06,-61.75
Aruba|America/Aruba|Oranjestad@12.52,-70.03
Curaçao|America/Curacao|Willemstad@12.11,-68.93
Bonaire|America/Kralendijk|Kralendijk@12.15,-68.27
Saint Pierre and Miquelon|America/Miquelon|Saint-Pierre@46.78,-56.18
Ecuador (Galápagos)|Pacific/Galapagos|Puerto Ayora=Galápagos@-0.74,-90.31
Chile|America/Punta_Arenas|Punta Arenas@-53.16,-70.91
Argentina|America/Argentina/Cordoba|Córdoba (Argentina)@-31.42,-64.18|Rosario@-32.95,-60.64|Tucumán@-26.82,-65.22
Argentina|America/Argentina/Mendoza|Mendoza@-32.89,-68.84
Argentina|America/Argentina/Salta|Salta@-24.79,-65.41|Neuquén@-38.95,-68.06|Bariloche=San Carlos de Bariloche@-41.13,-71.31
Argentina|America/Argentina/Ushuaia|Ushuaia@-54.8,-68.3
Brazil|America/Bahia|Salvador@-12.97,-38.5
Brazil|America/Fortaleza|Fortaleza@-3.73,-38.53|Natal@-5.79,-35.21|São Luís@-2.53,-44.3|Teresina@-5.09,-42.8
Brazil|America/Recife|Recife@-8.05,-34.88|João Pessoa@-7.12,-34.86
Brazil|America/Maceio|Maceió@-9.67,-35.74|Aracaju@-10.91,-37.07
Brazil|America/Belem|Belém@-1.46,-48.5
Brazil|America/Cuiaba|Cuiabá@-15.6,-56.1
Brazil|America/Campo_Grande|Campo Grande@-20.47,-54.62
Brazil|America/Porto_Velho|Porto Velho@-8.76,-63.9
Brazil|America/Rio_Branco|Rio Branco@-9.97,-67.81
Brazil|America/Noronha|Fernando de Noronha@-3.85,-32.42
Guyana|America/Guyana|Georgetown@6.8,-58.16
Suriname|America/Paramaribo|Paramaribo@5.85,-55.2
French Guiana|America/Cayenne|Cayenne@4.92,-52.33
Falkland Islands|Atlantic/Stanley|Stanley@-51.7,-57.85
South Georgia|Atlantic/South_Georgia|Grytviken@-54.28,-36.51
Antarctica|Antarctica/McMurdo|McMurdo Station@-77.85,166.67`;
