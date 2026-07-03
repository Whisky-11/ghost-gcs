FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y git python3 python3-pip python3-setuptools \
    gcc g++ make pkg-config libtool libxml2-dev libxslt1-dev curl && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --recurse-submodules --shallow-submodules \
    https://github.com/ArduPilot/ardupilot.git /ardupilot
WORKDIR /ardupilot
RUN pip3 install empy==3.3.4 pexpect future
RUN ./waf configure --board sitl && ./waf copter rover
EXPOSE 5760
COPY run-inner.sh /run-inner.sh
RUN chmod +x /run-inner.sh
ENTRYPOINT ["/run-inner.sh"]
