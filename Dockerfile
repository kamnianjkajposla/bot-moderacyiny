# Używamy oficjalnego i stabilnego środowiska Node.js
FROM node:20-alpine

# Tworzymy katalog roboczy w kontenerze
WORKDIR /usr/src/app

# Kopiujemy pliki package.json oraz package-lock.json (jeśli istnieje)
COPY package*.json ./

# Instalujemy zależności w kontenerze
RUN npm install

# Kopiujemy całą resztę kodu bota oraz plik konfiguracyjny
COPY . .

# Komenda startowa uruchamiająca bota
CMD ["node", "botdcpracz.js"]
