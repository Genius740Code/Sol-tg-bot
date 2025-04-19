#include <iostream>
#include <string>
#include <random>

std::string generateRandomString(int length) {
    const std::string characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    std::string result;
    result.reserve(length); 

    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> dis(0, characters.size() - 1);

    for (int i = 0; i < length; ++i) {
        result += characters[dis(gen)];
    }
    return result;
}

int main() {
    int length = 40;
    std::string randomString = generateRandomString(length);
    std::cout << randomString << std::endl;
    return 0;
}

// cpp for speed

//g++ -o test test.cpp
